// ══════════════════════════════════════════════════════════════
// DATA PROCESSING MODULES
// ══════════════════════════════════════════════════════════════
import { applyPrecisionToRows } from '../utils/data.js';
import { balanceRows } from '../utils/balanceRows.js';
import {
  pearsonR2, ols, p4, p6, mean, variance, median, stddev,
  makePRNG, shuffle, bootstrapSample, buildTree, predictTree,
  buildFeatContext, bucketBounds, interpolateBuckets,
  stratifiedTrainTestBySource,
} from '../utils/math.js';

function normalize(inp) {
  if (!inp) return [];
  if (!Array.isArray(inp)) return [inp];
  return inp;
}

// ── Per-key R² helper ─────────────────────────────────────────────────────────
// Computes Pearson R² of model predictions vs actuals grouped by key.
// keyMod: if set, strips everything from the first occurrence onward
// (e.g. keyMod='_' turns 'SPY_1' → 'SPY') for display grouping ONLY.
// Returns { dv: { key: r2, ... } } sorted best → worst per DV.
function perKeyR2(data, predsMap, depVars, keyField, keyMod) {
  const result = {};
  for (const dv of depVars) {
    const preds = predsMap[dv] || [];
    const groups = {};
    data.forEach((r, i) => {
      const raw = String(r[keyField] ?? '');
      const key = keyMod ? raw.split(keyMod)[0] : raw;
      if (!key) return;
      if (!groups[key]) groups[key] = { p: [], a: [] };
      const a = Number(r[dv]);
      const p = preds[i];
      if (!isNaN(a) && p != null) { groups[key].p.push(p); groups[key].a.push(a); }
    });
    const entries = Object.entries(groups)
      .map(([k, { p, a }]) => [k, p.length >= 2 ? p4(pearsonR2(p, a)) : null])
      .filter(([, v]) => v != null)
      .sort(([, a], [, b]) => b - a);
    result[dv] = Object.fromEntries(entries);
  }
  return result;
}

// ── Pearson R² ─────────────────────────────────────────────────────────────
export function runPearsonRsq(node, { cfg, inputs, setHeaders }) {
  const data    = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const rsqCfg   = cfg.rsq || { dep: [], indep: [] };
  const depVars  = (rsqCfg.dep || []).filter(Boolean);
  const indepVars= (rsqCfg.indep || []).filter(iv => iv.enabled !== false && iv.name);
  if (!depVars.length || !indepVars.length) return { data: [], _rows: [] };
  const getCol  = f => data.map(r => { const v = Number(r[f]); return isNaN(v) ? null : v; });
  const depCols  = depVars.map(f => ({ name: f, vals: getCol(f) }));
  const indepCols= indepVars.map(iv => ({ name: iv.name, vals: getCol(iv.name) }));
  const matrix   = indepCols.map(iv => {
    const depRSQs = depCols.map(dv => {
      const xs = iv.vals, ys = dv.vals;
      const pairs = xs.map((x,i)=>[x,ys[i]]).filter(([x,y])=>x!==null&&y!==null&&!isNaN(x)&&!isNaN(y));
      const n = pairs.length;
      if (n < 2) return null;
      const mx = pairs.reduce((s,[x])=>s+x,0)/n;
      const my = pairs.reduce((s,[,y])=>s+y,0)/n;
      let num=0,dx2=0,dy2=0;
      pairs.forEach(([x,y])=>{num+=(x-mx)*(y-my);dx2+=(x-mx)**2;dy2+=(y-my)**2;});
      const d=Math.sqrt(dx2*dy2); if(!d) return null;
      return Math.round((num/d)**2*1e4)/1e4;
    });
    const valid = depRSQs.filter(v => v !== null);
    let netRSQ = null;
    if (valid.length) {
      const mn = valid.reduce((s,v)=>s+v,0)/valid.length;
      const md = median(valid);
      netRSQ = Math.round(((mn + md)/2)*1e4)/1e4;
    }
    return { indep: iv.name, depRSQs, netRSQ };
  });
  matrix.sort((a,b) => (b.netRSQ??-Infinity) - (a.netRSQ??-Infinity));
  const out = matrix.map((row, ri) => {
    const r = { rank: ri+1, independent_variable: row.indep };
    depVars.forEach((dv,di) => { r[dv] = row.depRSQs[di]; });
    r['Net_RSQ'] = row.netRSQ;
    return r;
  });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k => !k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── MV Regression ─────────────────────────────────────────────────────────
// ── Multivariate Regression ───────────────────────────────────────────────
// Modes: New, Replace, Merge, Stored — mirrors RF model semantics.
// Stores exact OLS coefficients per dep var; trainRows stripped before persisting.
// Train R² + Test R² stored on registry for downstream ensemble weighting.
export function runMvRegression(node, { cfg, inputs, setHeaders, mvRegistry, setMvRegistry, openMvDashboard }) {
  const data    = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const rsqRows = normalize(inputs.rsq || []);

  let depVars, featuresOrdered;
  if (rsqRows.length) {
    const skip = new Set(['rank','independent_variable','Net_RSQ']);
    depVars = Object.keys(rsqRows[0]).filter(k => !skip.has(k) && !k.startsWith('_'));
    featuresOrdered = [...rsqRows].sort((a,b)=>(a.rank||999)-(b.rank||999)).map(r=>r.independent_variable).filter(Boolean);
  } else {
    const mvCfg = cfg.mv || { dep:[], indep:[] };
    depVars = (mvCfg.dep||[]).filter(Boolean);
    featuresOrdered = (mvCfg.indep||[]).filter(iv=>iv.enabled!==false&&iv.name).map(iv=>iv.name);
  }
  if (!depVars.length || !featuresOrdered.length) return { data: data.map(r=>({...r})), _rows: data.map(r=>({...r})) };

  const topNRaw      = cfg.top_feats === 'All' ? Infinity : parseInt(cfg.top_feats || '10');
  const testPct      = parseFloat((cfg.test_pct || '20%').replace('%','')) / 100;
  const modelName    = (cfg.model_name || '').trim();
  const modelMode    = cfg.model_mode || 'New';
  const useIntercept = cfg.use_intercept === true || cfg.use_intercept === 'true';
  const mvPfx        = modelName ? modelName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'MV' : 'MV';
  const mvKeyField   = (cfg.key_field || 'symbol').trim();
  const mvKeyMod     = (cfg.key_modifier ?? '_').trim();
  const rng          = makePRNG(Number(cfg.seed ?? 42));

  let registry = mvRegistry || {};
  if (modelMode === 'Replace' && modelName && registry[modelName]) {
    const nr = { ...registry }; delete nr[modelName]; setMvRegistry?.(nr); registry = nr;
  }

  const overallTopFeats = topNRaw < Infinity ? featuresOrdered.slice(0, topNRaw) : featuresOrdered;

  // ── Internal Pearson ranking (per DV) — fires only when topN cap would actually trim features.
  // rsq wire takes priority; this is the self-sufficient fallback so no external wire is needed.
  function pearsonRankFeatsMV(dv, feats) {
    if (topNRaw >= feats.length) return feats; // cap wouldn't cut anything — skip
    const yVals = data.map(r => { const v = Number(r[dv]); return isNaN(v) ? null : v; });
    const scored = feats.map(f => {
      const xVals = data.map(r => { const v = Number(r[f]); return isNaN(v) ? null : v; });
      const pairs = xVals.map((x,i) => [x, yVals[i]]).filter(([x,y]) => x != null && y != null);
      const r2 = pairs.length >= 4 ? pearsonR2(pairs.map(([x])=>x), pairs.map(([,y])=>y)) : 0;
      return { f, r2 };
    });
    scored.sort((a, b) => b.r2 - a.r2);
    return scored.slice(0, topNRaw).map(s => s.f);
  }

  function getDepVarFeats(dv) {
    // rsq wire connected — use its ranking directly
    if (rsqRows.length) {
      const ranked = [...rsqRows]
        .filter(r => r.independent_variable && r[dv] != null)
        .sort((a,b) => (b[dv]||0) - (a[dv]||0))
        .map(r => r.independent_variable);
      const dvTop = topNRaw < Infinity ? ranked.slice(0, topNRaw) : ranked;
      const union = [...overallTopFeats];
      dvTop.forEach(f => { if (!union.includes(f)) union.push(f); });
      return union;
    }
    // Internal Pearson ranking — only fires when cap would actually cut features
    return pearsonRankFeatsMV(dv, featuresOrdered);
  }

  // useIntercept=true  → X row is [1, f1, f2, ...],  coeffs[0]=intercept
  // useIntercept=false → X row is [f1, f2, ...],      no intercept term (forced-zero OLS)
  function buildXRows(feats, rows) {
    return rows.map(r => {
      const row = useIntercept ? [1] : [];
      feats.forEach(f => { const v=Number(r[f]); row.push(isNaN(v)?0:v); });
      return row;
    });
  }
  function predictRows(feats, coeffs, rows) {
    const off = useIntercept ? 1 : 0;
    return rows.map(r => {
      let val = useIntercept ? (coeffs[0]||0) : 0;
      feats.forEach((f,i) => { const v=Number(r[f]); val+=(isNaN(v)?0:v)*(coeffs[i+off]||0); });
      return val;
    });
  }

  // ── Stored only: apply exact stored coefficients, no training ─────────────
  if (modelMode === 'Stored' && modelName && registry[modelName]) {
    const storedModel = registry[modelName];
    // Use the intercept setting from the stored model (not current cfg, as model was trained with it)
    const storedUseInt = storedModel.useIntercept ?? true; // older models default to true (had intercept)
    const storedPreds = {};
    depVars.forEach(dv => {
      const sc = storedModel.coefficients?.[dv];
      const sf = storedModel.featureSet?.[dv] || [];
      if (!sc || !sf.length) { storedPreds[dv] = data.map(()=>null); return; }
      storedPreds[dv] = data.map(r => {
        let pred = storedUseInt ? (sc.intercept || 0) : 0;
        sf.forEach(f => { const v=Number(r[f]); pred+=(isNaN(v)?0:v)*(sc.coeffMap?.[f]||0); });
        return pred;
      });
    });

    // Compute R² of stored predictions against actuals on the current dataset
    const currentR2 = {};
    depVars.forEach(dv => {
      const preds  = storedPreds[dv] || [];
      const yCol   = data.map(r => { const v=Number(r[dv]); return isNaN(v)?null:v; });
      const pairs  = data.map((_,i)=>[preds[i],yCol[i]]).filter(([p,a])=>p!=null&&a!=null);
      currentR2[dv] = pairs.length >= 2 ? p4(pearsonR2(pairs.map(([p])=>p), pairs.map(([,a])=>a))) : 0;
    });

    const out = data.map((r, i) => {
      const row = { ...r };
      depVars.forEach(dv => {
        const p = storedPreds[dv]?.[i];
        row[`${mvPfx}_${dv}`]        = p != null ? p4(p) : null;
        row[`${mvPfx}_trainR2_${dv}`] = storedModel.trainR2?.[dv] ?? null;
        row[`${mvPfx}_testR2_${dv}`]  = storedModel.testR2?.[dv]  ?? null;
      });
      return row;
    });
    openMvDashboard?.({ modelResults:{}, depVars, storedModel, effectiveMode:'Stored', currentR2,
      keyR2: perKeyR2(data, storedPreds, depVars, mvKeyField, mvKeyMod) });
    if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
    return { data: out, _rows: out };
  }

  // ── Training data: Merge appends to stored trainRows ──────────────────────
  let trainData = data;
  let trainIdx, testIdx, outputIndices;
  if (modelMode === 'Merge' && modelName && registry[modelName]?.trainRows?.length) {
    const oldRows = registry[modelName].trainRows;
    trainData = [...oldRows, ...data];
    const split = stratifiedTrainTestBySource([oldRows.length, data.length], testPct, rng);
    trainIdx = split.trainIdx; testIdx = split.testIdx;
    outputIndices = Array.from({length:data.length},(_,i)=>oldRows.length+i);
  } else {
    const indices = shuffle(Array.from({length:data.length},(_,i)=>i), rng);
    const nTest   = Math.max(1, Math.round(data.length * testPct));
    testIdx  = indices.slice(0, nTest); trainIdx = indices.slice(nTest);
    outputIndices = Array.from({length:data.length},(_,i)=>i);
  }
  const testSet = new Set(testIdx);

  const modelResults = {};
  depVars.forEach(dv => {
    const dvFeats    = getDepVarFeats(dv);
    const yCol       = trainData.map(r => { const v=Number(r[dv]); return isNaN(v)?null:v; });
    const trainValid = trainIdx.filter(i=>yCol[i]!==null);
    const testValid  = testIdx.filter(i=>yCol[i]!==null);
    if (trainValid.length < 3) { modelResults[dv]={selectedFeats:[],coeffMap:{},intercept:0,trainR2:0,testR2:0}; return; }
    const yTrain = trainValid.map(i=>yCol[i]);
    let selectedFeats=[], currentR2=0, dropped=[];
    for (const feat of dvFeats) {
      const cand=[...selectedFeats,feat];
      const Xmat=buildXRows(cand,trainValid.map(i=>trainData[i]));
      const coeffs=ols(Xmat,yTrain);
      if (!coeffs){dropped.push(feat);continue;}
      const preds=predictRows(cand,coeffs,trainValid.map(i=>trainData[i]));
      const r2=pearsonR2(preds,yTrain);
      if (r2>currentR2+1e-6){selectedFeats=cand;currentR2=r2;}else{dropped.push(feat);}
    }
    for (const feat of dropped) {
      const cand=[...selectedFeats,feat];
      const Xmat=buildXRows(cand,trainValid.map(i=>trainData[i]));
      const coeffs=ols(Xmat,yTrain); if(!coeffs) continue;
      const preds=predictRows(cand,coeffs,trainValid.map(i=>trainData[i]));
      const r2=pearsonR2(preds,yTrain);
      if (r2>currentR2+1e-6){selectedFeats=cand;currentR2=r2;}
    }
    const finalXmat   = buildXRows(selectedFeats,trainValid.map(i=>trainData[i]));
    const finalCoeffs = ols(finalXmat,yTrain)||new Array(selectedFeats.length+(useIntercept?1:0)).fill(0);
    const intercept   = useIntercept ? finalCoeffs[0] : 0;
    const coeffOff    = useIntercept ? 1 : 0;
    const coeffMap    = {};
    selectedFeats.forEach((f,i)=>{coeffMap[f]=p6(finalCoeffs[i+coeffOff]);});
    dvFeats.forEach(f=>{if(!(f in coeffMap))coeffMap[f]=0;});
    const trainR2 = p4(currentR2);
    let testR2 = 0;
    if (testValid.length>=2) {
      const tp=predictRows(selectedFeats,finalCoeffs,testValid.map(i=>trainData[i]));
      testR2=p4(pearsonR2(tp,testValid.map(i=>yCol[i])));
    }
    modelResults[dv]={selectedFeats,coeffMap,intercept:p6(intercept),trainR2,testR2,baseFeats:dvFeats};
  });

  // ── Store exact coefficients ──────────────────────────────────────────────
  if (modelName && modelMode !== 'Stored') {
    let saveName = modelName;
    if (modelMode === 'New' && registry[saveName]) {
      let n=1; while(registry[saveName+'_'+n]) n++; saveName=modelName+'_'+n;
    }
    const trainR2out={}, testR2out={}, coefficients={}, featureSetOut={};
    depVars.forEach(dv=>{
      const r=modelResults[dv]||{};
      trainR2out[dv]=r.trainR2??0; testR2out[dv]=r.testR2??0;
      coefficients[dv]={intercept:r.intercept??0,coeffMap:r.coeffMap??{}};
      featureSetOut[dv]=r.selectedFeats||[];
    });
    setMvRegistry?.({
      ...registry,
      [saveName]: { name:saveName, runCount:1, totalSamples:trainData.length, updated:new Date().toISOString(),
        depVars:[...depVars], coefficients, featureSet:featureSetOut, trainR2:trainR2out, testR2:testR2out,
        useIntercept,
        trainRows:trainData }, // trainRows stripped before Supabase persist
    });
  }

  // Pre-compute predictions for all DVs (used in output rows AND perKeyR2)
  const mvPreds = {};
  depVars.forEach(dv => {
    const {selectedFeats,coeffMap,intercept}=modelResults[dv]||{};
    mvPreds[dv] = data.map(r => {
      if (!selectedFeats?.length) return null;
      let pred = intercept || 0;
      selectedFeats.forEach(f => { const v = Number(r[f]); pred += (isNaN(v)?0:v) * (coeffMap?.[f]||0); });
      return pred;
    });
  });

  const out = data.map((r,i) => {
    const row={...r};
    row[`${mvPfx}_train_test`] = testSet.has(outputIndices[i]) ? 'test' : 'train';
    depVars.forEach(dv=>{
      const {trainR2,testR2}=modelResults[dv]||{};
      row[`${mvPfx}_${dv}`]          = mvPreds[dv]?.[i] != null ? p4(mvPreds[dv][i]) : null;
      row[`${mvPfx}_trainR2_${dv}`]  = trainR2??null;
      row[`${mvPfx}_testR2_${dv}`]   = testR2??null;
    });
    return row;
  });
  openMvDashboard?.({modelResults,depVars,testSet,effectiveMode:modelMode,storedModel:null,
    keyR2: perKeyR2(data, mvPreds, depVars, mvKeyField, mvKeyMod) });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── Random Forest ─────────────────────────────────────────────────────────
// Modes: New (train on current data, store exact RF; name versioned if duplicate),
//        Replace (clear existing model, then same as New),
//        Stored (only apply stored RF to current data — no training),
//        Merge (append current data to stored trainRows, stratified split, one new RF, replace stored).
export async function runRandForest(node, { cfg, inputs, setHeaders, rfRegistry, setRfRegistry, openRFDashboard }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const rsqRows = normalize(inputs.rsq || []);
  let depVars, featuresOrdered;
  if (rsqRows.length) {
    const skip = new Set(['rank','independent_variable','Net_RSQ']);
    depVars = Object.keys(rsqRows[0]).filter(k => !skip.has(k) && !k.startsWith('_'));
    featuresOrdered = [...rsqRows].sort((a,b)=>(a.rank||999)-(b.rank||999)).map(r=>r.independent_variable).filter(Boolean);
  } else {
    const rfCfg = cfg.rf || { dep:[],indep:[] };
    depVars = (rfCfg.dep||[]).filter(Boolean);
    featuresOrdered = (rfCfg.indep||[]).filter(iv=>iv.enabled!==false&&iv.name).map(iv=>iv.name);
  }
  if (!depVars.length || !featuresOrdered.length) return { data: data.map(r=>({...r})), _rows: data.map(r=>({...r})) };

  const nTrees         = parseInt(cfg.n_trees || '50');
  const maxDepth       = cfg.max_depth === 'unlimited' ? Infinity : parseInt(cfg.max_depth || '5');
  const minSamp        = parseInt(cfg.min_samples || '5');
  const minSampSplit   = parseInt(cfg.min_samples_split || '5');
  const testPct        = parseFloat((cfg.test_pct || '20%').replace('%','')) / 100;
  const maxThresh      = (cfg.split_candidates === 'All' || cfg.max_thresholds === 'All')
    ? Infinity
    : parseInt(cfg.split_candidates || cfg.max_thresholds || '100');
  const topNRaw        = cfg.top_feats === 'All' ? Infinity : parseInt(cfg.top_feats || '10');
  const featEng        = cfg.feat_eng === true || cfg.feat_eng === 'true';
  const engTop         = featEng ? parseInt(cfg.eng_top || '5') : 0;
  const modelName      = (cfg.model_name || '').trim();
  const modelMode      = cfg.model_mode || 'New';
  const maxStoredTrees = parseInt(cfg.max_stored_trees || '100');
  const rfKeyField     = (cfg.key_field || 'symbol').trim();
  const rfKeyMod       = (cfg.key_modifier ?? '_').trim();
  const pfx = modelName ? modelName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'RF' : 'RF';

  let registry = rfRegistry || {};
  if (modelMode === 'Replace' && modelName && registry[modelName]) {
    const newReg = { ...registry };
    delete newReg[modelName];
    setRfRegistry?.(newReg);
    registry = newReg;
  }

  const storedModel = (modelMode === 'Stored' && modelName && registry[modelName]) ? registry[modelName] : null;

  const rng = makePRNG(Number(cfg.seed ?? 42));

  // ── Internal Pearson ranking (per DV) used when topN cap would actually cut features.
  // Skipped entirely when "All" is chosen or the candidate set already fits within the cap.
  // rsq wire takes priority if connected; internal ranking is the fallback.
  function pearsonRankFeats(dv, feats) {
    if (topNRaw >= feats.length) return feats; // cap wouldn't trim anything — skip
    const yVals = data.map(r => { const v = Number(r[dv]); return isNaN(v) ? null : v; });
    const scored = feats.map(f => {
      const xVals = data.map(r => { const v = Number(r[f]); return isNaN(v) ? null : v; });
      const pairs = xVals.map((x,i) => [x, yVals[i]]).filter(([x,y]) => x != null && y != null);
      const r2 = pairs.length >= 4 ? pearsonR2(pairs.map(([x])=>x), pairs.map(([,y])=>y)) : 0;
      return { f, r2 };
    });
    scored.sort((a, b) => b.r2 - a.r2);
    return scored.slice(0, topNRaw).map(s => s.f);
  }

  const overallTopFeats = topNRaw < Infinity ? featuresOrdered.slice(0, topNRaw) : featuresOrdered;

  function getDepVarFeats(dv) {
    // If rsq wire is connected, use it (it already carries ranked features)
    if (rsqRows.length) {
      const ranked = [...rsqRows].filter(r=>r.independent_variable&&r[dv]!==undefined&&r[dv]!==null)
        .sort((a,b)=>(b[dv]||0)-(a[dv]||0)).map(r=>r.independent_variable);
      const dvTop = topNRaw < Infinity ? ranked.slice(0, topNRaw) : ranked;
      const union = [...overallTopFeats];
      dvTop.forEach(f => { if (!union.includes(f)) union.push(f); });
      return union;
    }
    // Internal Pearson ranking — only fires when cap would actually cut features
    return pearsonRankFeats(dv, featuresOrdered);
  }

  // ── Stored only: apply exact stored RF to current data, no training ───────
  if (modelMode === 'Stored' && storedModel) {
    const storedPreds = {};
    depVars.forEach(dv => {
      const storedTrees = storedModel.trees?.[dv] || [];
      if (!storedTrees.length) return;
      const storedBaseFeats = storedModel.baseFeatureSet?.[dv]||storedModel.featureSet?.[dv]||overallTopFeats;
      const { Xmat:Xstored } = buildFeatContext(storedBaseFeats, data);
      function inferTree(nd, ri) {
        if ('val' in nd) return nd.val;
        const v = Xstored[ri]?.[nd.feat]??0;
        return v<=nd.thresh ? inferTree(nd.left,ri) : inferTree(nd.right,ri);
      }
      const totalW = storedTrees.reduce((s,t)=>s+(t.weight||1),0)||1;
      const preds  = new Array(data.length).fill(0);
      storedTrees.forEach(({weight,nodes:tRoot})=>{
        const w=(weight||1)/totalW;
        for(let i=0;i<data.length;i++) preds[i]+=inferTree(tRoot,i)*w;
      });
      storedPreds[dv] = preds;
    });
    const storedOverallR2 = {};
    depVars.forEach(dv => {
      const sp  = storedPreds[dv]||[];
      const yCol= data.map(r=>{const v=Number(r[dv]);return isNaN(v)?null:v;});
      const pairs = data.map((_,i)=>[sp[i],yCol[i]]).filter(([p,a])=>p!=null&&a!=null);
      if (pairs.length<2){storedOverallR2[dv]=0;return;}
      storedOverallR2[dv]=p4(pearsonR2(pairs.map(([p])=>p),pairs.map(([,a])=>a)));
    });
    const storedTrainR2 = storedModel.trainR2 || {};
    const storedTestR2  = storedModel.testR2  || storedOverallR2;
    const out = data.map((r,i)=>{
      const row={...r};
      row[`${pfx}_train_test`]='stored';
      depVars.forEach(dv=>{
        row[`${pfx}_${dv}`]=storedPreds[dv]?.[i]!=null?p4(storedPreds[dv][i]):null;
        row[`${pfx}_trainR2_${dv}`]=storedTrainR2[dv]??null;
        row[`${pfx}_testR2_${dv}`]=storedTestR2[dv]??null;
      });
      return row;
    });
    openRFDashboard?.({ rfResults:{}, depVars, data, testSet:new Set(), storedModel, storedPreds, storedOverallR2, effectiveMode:'Stored',
      keyR2: perKeyR2(data, storedPreds, depVars, rfKeyField, rfKeyMod) });
    if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
    return { data: out, _rows: out, trainR2: storedTrainR2, testR2: storedTestR2 };
  }

  // ── Training data and split: New/Replace = current data; Merge = combined + stratified ─────
  let trainData = data;
  let trainIdx, testIdx, testSet, outputIndices;
  if (modelMode === 'Merge' && modelName && registry[modelName]) {
    const existing = registry[modelName];
    const oldRows = existing.trainRows || [];
    trainData = [...oldRows, ...data];
    const segmentLengths = [oldRows.length, data.length];
    const split = stratifiedTrainTestBySource(segmentLengths, testPct, rng);
    trainIdx = split.trainIdx;
    testIdx = split.testIdx;
    testSet = new Set(split.testIdx);
    outputIndices = Array.from({ length: data.length }, (_, i) => oldRows.length + i);
  } else {
    const indices = shuffle(Array.from({length:data.length},(_,i)=>i), rng);
    const nTest = Math.max(1, Math.round(data.length * testPct));
    testSet = new Set(indices.slice(0, nTest));
    trainIdx = indices.slice(nTest);
    testIdx = indices.slice(0, nTest);
    outputIndices = Array.from({ length: data.length }, (_, i) => i);
  }

  const rfResults = {};
  depVars.forEach(dv => {
    const dvBaseFeats = getDepVarFeats(dv);
    const { allFeats:dvAllFeats, engFeatNames:dvEngFeats, Xmat:dvX, nFeats:dvNF } = buildFeatContext(dvBaseFeats, trainData, engTop);
    const yCol = trainData.map(r => { const v=Number(r[dv]); return isNaN(v)?null:v; });
    const trainRowsFull = trainIdx.filter(i=>yCol[i]!==null);
    const testRowsFull  = testIdx.filter(i=>yCol[i]!==null);
    if (trainRowsFull.length < minSamp) {
      const emptyPreds = outputIndices.map(()=>null);
      rfResults[dv] = { preds: emptyPreds, trainR2:0, testR2:0, importance:{}, baseFeats:dvBaseFeats, nEng:dvEngFeats.length, nTrain:trainRowsFull.length, nTest:testRowsFull.length, trees:[] };
      return;
    }
    const impAcc   = new Array(dvNF).fill(0);
    const fPreds   = new Array(trainData.length).fill(0);
    const fCount   = new Array(trainData.length).fill(0);
    const forest   = [];
    for (let t = 0; t < nTrees; t++) {
      const bootIdx = bootstrapSample(trainRowsFull, trainRowsFull.length, rng);
      const bootY   = bootIdx.map(i=>yCol[i]);
      const tree    = buildTree(bootIdx, bootY, 0, impAcc, dvX, dvNF, {minSamp, minSampSplit, maxDepth, maxThresh, rng});
      forest.push(tree);
      for (let i=0;i<trainData.length;i++) { if(yCol[i]!==null){fPreds[i]+=predictTree(tree,i,dvX);fCount[i]++;} }
    }
    const allPreds = fPreds.map((s,i)=>fCount[i]>0?s/fCount[i]:null);
    const preds = outputIndices.map(i=>allPreds[i]);
    const trainR2 = p4(pearsonR2(trainRowsFull.map(i=>allPreds[i]),trainRowsFull.map(i=>yCol[i])));
    const testR2  = p4(pearsonR2(testRowsFull.map(i=>allPreds[i]),testRowsFull.map(i=>yCol[i])));
    const totalImp = impAcc.reduce((s,v)=>s+v,0)||1;
    const importance = {};
    dvBaseFeats.forEach((f,i)=>{importance[f]=p6(impAcc[i]/totalImp);});
    rfResults[dv] = { preds,trainR2,testR2,importance,baseFeats:dvBaseFeats,allFeats:dvAllFeats,nEng:dvEngFeats.length,nTrain:trainRowsFull.length,nTest:testRowsFull.length,trees:forest };
  });

  const finalPreds = {};
  depVars.forEach(dv => { finalPreds[dv] = rfResults[dv]?.preds ?? outputIndices.map(()=>null); });

  // ── Collect per-DV R² summaries ───────────────────────────────────────────
  const trainR2out = {}, testR2out = {};
  depVars.forEach(dv => {
    trainR2out[dv] = rfResults[dv]?.trainR2 ?? 0;
    testR2out[dv]  = rfResults[dv]?.testR2  ?? 0;
  });

  // ── Store exact RF only (no blending with previous trees) ─────────────────
  if (modelName && modelMode !== 'Stored') {
    let saveName = modelName;
    if (modelMode === 'New' && registry[saveName]) {
      let n = 1;
      while (registry[saveName + '_' + n]) n++;
      saveName = modelName + '_' + n;
    }
    const perDvMax = Math.max(5, Math.floor(maxStoredTrees/depVars.length));
    const treesToStore = {};
    depVars.forEach(dv => {
      const fr = rfResults[dv];
      if (!fr || !fr.trees?.length) return;
      treesToStore[dv] = fr.trees.slice(0, perDvMax).map(tRoot=>({ weight: fr.testR2||0.01, samples: trainData.length, testR2: fr.testR2, nodes: tRoot }));
    });
    const featureSet = {};
    const baseFeatureSet = {};
    depVars.forEach(dv=>{
      featureSet[dv]=rfResults[dv]?.allFeats||overallTopFeats;
      baseFeatureSet[dv]=rfResults[dv]?.baseFeats||overallTopFeats;
    });
    const updatedReg = {
      ...registry,
      [saveName]: {
        name: saveName,
        runCount: 1,
        totalSamples: trainData.length,
        updated: new Date().toISOString(),
        depVars: [...depVars],
        trees: treesToStore,
        featureSet,
        baseFeatureSet,
        trainR2: trainR2out,
        testR2:  testR2out,
        trainRows: trainData,
      },
    };
    setRfRegistry?.(updatedReg);
  }

  const out = data.map((r,i)=>{
    const row={...r};
    row[`${pfx}_train_test`]=testSet.has(outputIndices[i])?'test':'train';
    depVars.forEach(dv=>{
      row[`${pfx}_${dv}`]=finalPreds[dv]?.[i]!=null?p4(finalPreds[dv][i]):null;
      row[`${pfx}_trainR2_${dv}`]=trainR2out[dv]??null;
      row[`${pfx}_testR2_${dv}`]=testR2out[dv]??null;
    });
    return row;
  });
  openRFDashboard?.({ rfResults, depVars, data, testSet, storedModel: null, storedPreds: {}, storedOverallR2: {}, effectiveMode: modelMode,
    keyR2: perKeyR2(data, finalPreds, depVars, rfKeyField, rfKeyMod) });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out, trainR2: trainR2out, testR2: testR2out };
}

// ── dp_precision ──────────────────────────────────────────────────────────────
export function runDpPrecision(node, { inputs }) {
  const rows = normalize(inputs.data || []);
  const processed = applyPrecisionToRows(rows);
  return { data: processed, _rows: processed };
}

// ── dataset ───────────────────────────────────────────────────────────────────
export function runDataset(node, { cfg, inputs, setHeaders }) {
  const raw  = normalize(inputs.data || inputs.filtered_data || inputs.joined_data || []);
  const ratio= parseInt((cfg.compression || '1:1').split(':')[0]);
  let rows   = raw;
  if (ratio > 1 && raw.length > 0) {
    const compressed = [];
    for (let i=0; i<raw.length; i+=ratio) {
      const bucket = raw.slice(i, i+ratio);
      if (!bucket.length) continue;
      const outRow = {...bucket[0]};
      Object.keys(outRow).forEach(k=>{
        const nums=bucket.map(r=>Number(r[k])).filter(v=>!isNaN(v));
        if (nums.length===bucket.length) outRow[k]=Math.round(nums.reduce((s,v)=>s+v,0)/nums.length*1e6)/1e6;
      });
      compressed.push(outRow);
    }
    rows = compressed;
  }
  if (rows.length) setHeaders(Object.keys(rows[0]).filter(k=>!k.startsWith('_')));
  return { data: rows, _rows: rows };
}

// ── manual_entry ──────────────────────────────────────────────────────────────
export function runManualEntry(node, { cfg, setHeaders }) {
  const field = (cfg.field || 'symbol').trim();
  const raw   = (cfg.values || '').split('\n').map(s=>s.trim()).filter(Boolean);
  const rows  = raw.map(v => ({ [field]: v }));
  setHeaders([field]);
  return { data: rows, _rows: rows };
}

// ── collect ───────────────────────────────────────────────────────────────────
export function runCollect(node, { cfg, inputs, setHeaders }) {
  const data  = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const field = cfg.field || '';
  const sep   = cfg.separator !== undefined ? cfg.separator : ',';
  const vals  = data.map(row => String(!field ? Object.values(row)[0] ?? '' : row[field] ?? ''))
    .filter(v => v !== '' && v !== 'undefined' && v !== 'null');
  const joined = vals.join(sep);
  const rows   = [{ collected: joined, count: vals.length }];
  setHeaders(['collected', 'count']);
  return { data: rows, _rows: rows, collected: joined, _scalar: joined };
}

// ── stat_* ────────────────────────────────────────────────────────────────────
export function runStat(node, { inputs, setHeaders }, statType) {
  const data = normalize(inputs.data || []);
  const allVals = [];
  data.forEach(row => Object.values(row).forEach(v => { const n=Number(v); if(!isNaN(n)&&v!==null&&v!=='') allVals.push(n); }));
  let statVal = null;
  if (allVals.length) {
    const sorted = [...allVals].sort((a,b)=>a-b);
    if (statType==='min')    statVal = sorted[0];
    if (statType==='max')    statVal = sorted[sorted.length-1];
    if (statType==='mean')   statVal = mean(allVals);
    if (statType==='median') statVal = median(allVals);
    if (statType==='stdev')  statVal = stddev(allVals);
  }
  const rows = [{ [statType]: statVal, n: allVals.length }];
  setHeaders([statType, 'n']);
  return { data: rows, _rows: rows };
}

// ── raw_to_prel ───────────────────────────────────────────────────────────────
export function runRawToPrel(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const field = cfg.field || '';
  if (!field) return { data, _rows: data };
  const vals  = data.map(row => Number(row[field])).filter(v => !isNaN(v));
  if (!vals.length) return { data, _rows: data };
  const p0Mode  = cfg.p0 || 'min';
  let p0;
  if (['first','mid','last'].includes(p0Mode)) {
    const keyField = cfg.key_field || '';
    if (!keyField) {
      const idx = p0Mode==='first'?0:p0Mode==='last'?data.length-1:Math.floor(data.length/2);
      p0 = Number(data[idx]?.[field]);
    } else {
      const withKey = data.map((row,i)=>({row,key:Number(row[keyField]),i})).filter(x=>!isNaN(x.key)).sort((a,b)=>a.key-b.key);
      const ki = p0Mode==='first'?0:p0Mode==='last'?withKey.length-1:Math.floor(withKey.length/2);
      p0 = Number(withKey[ki]?.row[field]);
    }
  } else {
    const sv=[...vals].sort((a,b)=>a-b);
    p0 = p0Mode==='max'?Math.max(...vals):p0Mode==='med'?median(vals):Math.min(...vals);
  }
  const out = data.map(row => {
    const raw  = Number(row[field]);
    const prel = isNaN(raw)||isNaN(p0)||p0===0 ? null : (raw-p0)/p0;
    return { ...row, [`${field}_prel`]: prel };
  });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── math_add/sub/mul/div ──────────────────────────────────────────────────────
export function runMathOp(node, { cfg, inputs, setHeaders }, op) {
  const aRows  = normalize(inputs.a || inputs.data || []);
  const bRows  = normalize(inputs.b || []);
  const aField = cfg.a_field  || '';
  const bMode  = cfg.b_mode   || 'constant';
  const bField = cfg.b_field  || '';
  const bConst = Number(cfg.b_const ?? (op==='mul'?1:0));
  const outF   = cfg.out_field || 'result';
  if (!aField) return { data: [], _rows: [] };
  const out = aRows.map((row,i)=>{
    const a = Number(row[aField]);
    const b = bMode==='field' ? Number((bRows[i]||bRows[0]||{})[bField]) : bConst;
    if (isNaN(a)||isNaN(b)) return { [outF]: null };
    let result;
    if (op==='add') result = p4(a+b);
    if (op==='sub') result = p4(a-b);
    if (op==='mul') result = p4(a*b);
    if (op==='div') result = b!==0 ? p4(a/b) : null;
    return { [outF]: result };
  });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── moving_avg ────────────────────────────────────────────────────────────────
export function runMovingAvg(node, { cfg, inputs, setHeaders }) {
  const data      = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const xF        = cfg.x_field   || 't_rel';
  const yF        = cfg.y_field   || 'p_rel';
  const symF      = cfg.sym_field || 'symbol';
  const bucketPct = parseFloat((cfg.bucket_pct || '20%').replace('%',''))/100;
  const direction = cfg.direction || 'closest';
  const nBands    = parseInt(cfg.bands || '1');
  const composite = cfg.composite===true||cfg.composite==='true';
  const bktMode   = cfg.bkt_mode  || 'blend';
  const bktCount  = parseInt(cfg.bkt_count || '5');
  const bktComp   = parseFloat(cfg.bkt_compound || '2.00');

  const bandSuffixes = {1:['_MA'],2:['_MA_L','_MA_H'],3:['_MA_L','_MA_m','_MA_H'],4:['_MA_LL','_MA_L','_MA_H','_MA_HH'],5:['_MA_LL','_MA_L','_MA_m','_MA_H','_MA_HH']};
  const suffixes     = bandSuffixes[nBands] || ['_MA'];
  const compColY     = `${yF}_MA`;

  function meanArr(arr) { return arr.length ? p4(arr.reduce((s,v)=>s+v,0)/arr.length) : null; }
  function bandSlice(sortedY, bi) {
    const total=sortedY.length; if(!total) return [];
    const start=Math.floor(bi*total/nBands), end=Math.min(total,Math.ceil((bi+1)*total/nBands));
    return sortedY.slice(start,end);
  }

  const bySymbol = {};
  data.forEach((row,oi)=>{
    const s=String(row[symF]??'');
    if(!bySymbol[s]) bySymbol[s]=[];
    const x=Number(row[xF]),y=Number(row[yF]);
    bySymbol[s].push({x,y,oi,valid:!isNaN(x)&&!isNaN(y)});
  });

  const outRows = data.map(row=>({...row}));

  Object.entries(bySymbol).forEach(([sym,pts])=>{
    const sorted = pts.filter(p=>p.valid).sort((a,b)=>a.x-b.x);
    const n = sorted.length; if (n<2) return;
    const bucketSize = Math.max(2,Math.round(n*bucketPct));
    const half = Math.floor(bucketSize/2);

    sorted.forEach((pt,si)=>{
      let wStart,wEnd;
      if(direction==='look_back'){wStart=Math.max(0,si-bucketSize+1);wEnd=si+1;}
      else if(direction==='look_ahead'){wStart=si;wEnd=Math.min(n,si+bucketSize);}
      else{wStart=Math.max(0,si-half);wEnd=Math.min(n,si+half+1);}
      const win=sorted.slice(wStart,wEnd);
      const sortedY=[...win.map(p=>p.y)].sort((a,b)=>a-b);
      if(composite&&nBands>1) outRows[pt.oi][compColY]=meanArr(sortedY);
      suffixes.forEach((suffix,bi)=>{
        const slice=bandSlice(sortedY,bi);
        outRows[pt.oi][`${yF}${suffix}`]=meanArr(slice);
      });
    });

    // Bucket mode
    if (bktMode !== 'bypass') {
      const xMin=sorted[0].x, xMax=sorted[n-1].x;
      const bounds = bucketBounds(xMin, xMax, bktCount, bktComp);
      const bucketCenters = bounds.slice(0,-1).map((b,i)=>(b+bounds[i+1])/2);
      const MAcols = bktMode==='raw' ? null : suffixes.map(s=>`${yF}${s}`);
      const yCol   = bktMode==='MA' ? MAcols?.[0] : yF;

      // Collect point-level values per bucket
      const bucketSums  = new Array(bktCount).fill(0);
      const bucketCounts= new Array(bktCount).fill(0);
      sorted.forEach(pt=>{
        const bi=bounds.findIndex((_,i)=>i<bktCount&&pt.x>=bounds[i]&&pt.x<bounds[i+1]);
        const idx=bi<0?bktCount-1:bi;
        const v=bktMode==='raw'?pt.y:Number(outRows[pt.oi]?.[yCol]??pt.y);
        if(!isNaN(v)){bucketSums[idx]+=v;bucketCounts[idx]++;}
      });
      const bucketVals = bucketSums.map((s,i)=>bucketCounts[i]>0?p4(s/bucketCounts[i]):null);
      const filled = interpolateBuckets(bucketCenters, bucketVals);

      // Assign bucket values back — blend=50% original 50% bucket
      sorted.forEach(pt=>{
        const bi=bounds.findIndex((_,i)=>i<bktCount&&pt.x>=bounds[i]&&pt.x<bounds[i+1]);
        const idx=bi<0?bktCount-1:bi;
        const bktVal=filled[idx];
        if(bktVal===null) return;
        if(bktMode==='blend') {
          const origV=Number(outRows[pt.oi]?.[MAcols?.[0]??yF]??pt.y);
          outRows[pt.oi][`${yF}_bkt`]=p4((isNaN(origV)?bktVal:origV+bktVal)/2);
        } else {
          outRows[pt.oi][`${yF}_bkt`]=bktVal;
        }
      });
    }
  });

  const allKeys = outRows.length ? Object.keys(outRows[0]).filter(k=>!k.startsWith('_')) : [];
  setHeaders(allKeys);
  return { data: outRows, _rows: outRows };
}

// ── convergences ──────────────────────────────────────────────────────────────
export function runConvergences(node, { cfg, inputs, setHeaders }) {
  const dataC = normalize(inputs.data || []);
  if (dataC.length < 2) return { features: [], actuals: [], data: [], _rows: [] };

  const xF       = cfg.x_field    || 't_rel';
  const yF       = cfg.y_field    || 'p_rel';
  const symF     = cfg.sym_field  || 'symbol';
  const vF       = cfg.v_field    || '';
  // Performance indicator fields — array of selected field names (from multidynfield)
  const perfFields = Array.isArray(cfg.perf_fields) ? cfg.perf_fields.filter(Boolean) : [];
  // Perf data source: dedicated 'perf' input if connected, else fall back to main data
  const perfDataRaw = normalize(inputs.perf || []);
  const perfData    = perfDataRaw.length ? perfDataRaw : null;
  const slicePct = parseFloat((cfg.slice || '50%').replace('%', '')) / 100;
  const trajMode = cfg.traj_mode  || 'Fwd';
  const pvDetect = (cfg.pv_detect || 'Enabled') === 'Enabled';
  const trajEnvFilter = (cfg.traj_env_filter || 'Off') === 'On';
  const cyFilterVal   = cfg.cy_filter || 'Off';

  const deg  = rad => p4(rad * 180 / Math.PI);
  const stdev = arr => {
    if (arr.length < 2) return 0;
    const mu = arr.reduce((s, v) => s + v, 0) / arr.length;
    return p4(Math.sqrt(arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length));
  };
  const vlty = arr => {
    if (arr.length < 2) return 0;
    const rets = [];
    for (let i = 1; i < arr.length; i++) {
      if (arr[i - 1] !== 0) rets.push((arr[i] - arr[i - 1]) / Math.abs(arr[i - 1]));
    }
    return stdev(rets);
  };

  function extractPV(pts) {
    if (pts.length <= 2) return pts;
    const keep = new Array(pts.length).fill(false);
    keep[0] = true; keep[pts.length - 1] = true;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1].y, cur = pts[i].y, next = pts[i + 1].y;
      if (prev < cur && next < cur)  { keep[i] = true; continue; }
      if (prev > cur && next > cur)  { keep[i] = true; continue; }
      if (prev < cur && next === cur){ keep[i] = true; continue; }
      if (prev === cur && next < cur){ keep[i] = true; continue; }
      if (prev > cur && next === cur){ keep[i] = true; continue; }
      if (prev === cur && next > cur){ keep[i] = true; continue; }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // Group by symbol
  const bySymbol = {};
  dataC.forEach(row => {
    const s = String(row[symF] ?? '');
    if (!bySymbol[s]) bySymbol[s] = [];
    bySymbol[s].push({
      x: p4(Number(row[xF])),
      y: p4(Number(row[yF])),
      v: vF ? Number(row[vF]) : null,
      sym: s,
    });
  });

  // Pre-build per-symbol last-value map from the perf data source
  // Key: symbol string → { fieldName: lastValue, … }
  const perfBySymbol = {};
  if (perfData && perfFields.length) {
    perfData.forEach(row => {
      const s = String(row[symF] ?? '');
      if (!perfBySymbol[s]) perfBySymbol[s] = {};
      perfFields.forEach(f => {
        const v = row[f];
        if (v !== undefined && v !== null && String(v) !== '') perfBySymbol[s][f] = v;
      });
    });
  }

  const allOut      = [];
  const allActuals  = [];

  Object.entries(bySymbol).forEach(([sym, pts]) => {
    const valid = pts.filter(p => !isNaN(p.x) && !isNaN(p.y)).sort((a, b) => a.x - b.x);
    if (valid.length < 2) return;

    const lastV   = vF ? (valid.map(p => p.v).filter(v => v !== null && !isNaN(v)).pop() ?? null) : null;
    // Lookup pre-extracted perf values for this symbol
    const lastPerf = perfBySymbol[sym] || {};
    const cutIdx  = Math.max(2, Math.round(valid.length * slicePct));
    const modelPts = valid.slice(0, cutIdx);
    const validPts = valid.slice(cutIdx);

    const t0 = modelPts[modelPts.length - 1].x;
    const p0 = modelPts[modelPts.length - 1].y;

    const scaled = modelPts.map(p => ({ ...p, x: p4(p.x - t0), y: p4(p.y - p0) }));
    const xMin   = scaled[0].x;
    const xMax   = scaled[scaled.length - 1].x;
    const yVals  = scaled.map(p => p.y);
    const yMin   = Math.min(...yVals), yMax = Math.max(...yVals);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const xAbsMax = Math.max(...scaled.map(p => Math.abs(p.x))) || 1;
    const envA   = xAbsMax > 0 ? yRange / Math.log(xAbsMax + 1) : 1;

    const StDev_Mod = stdev(yVals);
    const Vlty_Mod  = vlty(yVals);

    const asym    = v => p4(v / (1 + Math.abs(v)));
    const evalEnv = absX => p4(Math.max(0, envA * Math.log(Math.abs(absX) + 1)));

    const trajPts = pvDetect ? extractPV(scaled) : scaled;
    const xFutureCutoff = p4(xMax + Math.abs(xRange));

    const genTrajectories = pts => {
      const trajs = [];
      pts.forEach((p0s, i) => {
        const isLast = i === pts.length - 1;
        const fwd = (trajMode === 'Fwd' || trajMode === 'Both') ? pts.filter((_, j) => j > i) : [];
        const bwd = (trajMode === 'Bkwd' || trajMode === 'Both') && !isLast ? pts.filter((_, j) => j < i) : [];
        const slopesDir = others => {
          if (!others.length) return [];
          const slopes = others.map(p1 => {
            const dx = p4(p1.x - p0s.x);
            if (dx === 0) return null;
            const m = p4((p1.y - p0s.y) / dx);
            const b = p4(p0s.y - m * p0s.x);
            return { m, b, x1: p1.x, y1: p1.y };
          }).filter(Boolean);
          if (!slopes.length) return [];
          const maxM = slopes.reduce((a, c) => a.m >= c.m ? a : c);
          const minM = slopes.reduce((a, c) => a.m <= c.m ? a : c);
          const res = [maxM];
          if (minM.m !== maxM.m) res.push(minM);
          return res;
        };
        [...slopesDir(fwd), ...slopesDir(bwd)].forEach(line => {
          trajs.push({ sym, x0: p0s.x, y0: p0s.y, x1: line.x1, y1: line.y1, m: line.m, b: line.b });
        });
      });
      return trajs;
    };

    const intersectionMap = new Map();
    const trajectories    = genTrajectories(trajPts);

    let allLines = trajectories.filter((t, idx, arr) => {
      const lk = `${t.m}|${t.b}`;
      return arr.findIndex(x => `${x.m}|${x.b}` === lk) === idx;
    });

    if (trajEnvFilter) {
      const scanLimit = xFutureCutoff * 2;
      const steps = 40;
      const checkXs = [];
      for (let s = 0; s <= steps; s++) checkXs.push(p4(scanLimit * s / steps));
      allLines = allLines.filter(t => {
        let prevGapPos = null, prevGapNeg = null;
        for (const x of checkXs) {
          const yLine  = t.m * x + t.b;
          const envPos = evalEnv(x);
          const envNeg = asym(-envPos);
          const gapPos = yLine - envPos;
          const gapNeg = yLine - envNeg;
          if (gapPos <= 0 && gapNeg >= 0) return true;
          if (prevGapPos !== null) {
            if (prevGapPos * gapPos < 0) return true;
            if (prevGapNeg * gapNeg < 0) return true;
          }
          prevGapPos = gapPos;
          prevGapNeg = gapNeg;
        }
        return false;
      });
    }

    for (let i = 0; i < allLines.length; i++) {
      const t1 = allLines[i];
      for (let j = i + 1; j < allLines.length; j++) {
        const t2 = allLines[j];
        if (t1.m === t2.m) continue;
        const denom = p4(t1.m - t2.m);
        if (denom === 0) continue;
        const cx = p4((t2.b - t1.b) / denom);
        const cy = p4((t1.m * t2.b - t2.m * t1.b) / denom);
        if (cx <= xMax) continue;
        if (cx > xFutureCutoff) continue;
        if (cyFilterVal !== 'Off') {
          const cyMult  = parseFloat(cyFilterVal);
          const envAtCx = evalEnv(Math.abs(cx));
          const filterPos = envAtCx * cyMult;
          const filterNeg = asym(-envAtCx) * cyMult;
          if (cy > filterPos || cy < filterNeg) continue;
        }
        const key = `${cx}|${cy}`;
        if (intersectionMap.has(key)) continue;
        const OA   = deg(Math.atan2(cy, cx));
        const mProd = t1.m * t2.m;
        const CA   = deg(Math.atan(Math.abs(t1.m - t2.m) / (1 + (mProd === -1 ? 0.0001 : mProd))));
        const cProx = p4((t1.x0 + t1.x1 + t2.x0 + t2.x1) / 4);
        const cxEnvPos = evalEnv(Math.abs(cx));
        const cxEnvNeg = asym(-cxEnvPos);
        // Predicted std-dev / volatility at convergence distance, scaled by envelope growth
        const stdevpred = p4(StDev_Mod * cxEnvPos / (yRange || 1));
        const vltypred  = p4(Vlty_Mod  * cxEnvPos / (yRange || 1));
        // yenva: asymptotic compression of the envelope at cx (maps unbounded env → (0,1))
        const yenva     = p4(asym(cxEnvPos));

        intersectionMap.set(key, {
          symbol: sym,
          x0: t1.x0, y0: t1.y0, x1: t1.x1, y1: t1.y1, m1: t1.m, b1: t1.b,
          x20: t2.x0, y20: t2.y0, x21: t2.x1, y21: t2.y1, m2: t2.m, b2: t2.b,
          cx, cy,
          x_ray_end: xMax,
          OA, CA,
          StDev_Mod, Vlty_Mod,
          stdevpred, vltypred, yenva,
          v: lastV,
          ...lastPerf,   // performance indicator snapshots (right of v)
          cProx,
          ci: null,
          cx_env_pos: cxEnvPos,
          cx_env_neg: cxEnvNeg,
          val_raw: null, val_avg: null, val_min: null, val_max: null,
        });
      }
    }

    // Compute CI (Convergence Index)
    const allIntersections = [...intersectionMap.values()];
    const lineIntersections = new Map();
    allIntersections.forEach(rec => {
      const k1 = `${rec.m1}|${rec.b1}`;
      const k2 = `${rec.m2}|${rec.b2}`;
      if (!lineIntersections.has(k1)) lineIntersections.set(k1, []);
      if (!lineIntersections.has(k2)) lineIntersections.set(k2, []);
      lineIntersections.get(k1).push(rec.cx);
      lineIntersections.get(k2).push(rec.cx);
    });
    lineIntersections.forEach(arr => arr.sort((a, b) => a - b));
    allIntersections.forEach(rec => {
      const k1   = `${rec.m1}|${rec.b1}`;
      const k2   = `${rec.m2}|${rec.b2}`;
      const arr1 = lineIntersections.get(k1) || [rec.cx];
      const arr2 = lineIntersections.get(k2) || [rec.cx];
      const rank1 = arr1.length > 1 ? arr1.indexOf(rec.cx) / (arr1.length - 1) : 0.5;
      const rank2 = arr2.length > 1 ? arr2.indexOf(rec.cx) / (arr2.length - 1) : 0.5;
      rec.ci = p4((rank1 + rank2) / 2);
    });
    allIntersections.forEach(rec => allOut.push(rec));

    // Actuals output
    const allPts = valid;
    allPts.forEach(vp => {
      const xAct = p4(vp.x - t0);
      const yAct = p4(vp.y - p0);
      const actEnvPos = evalEnv(Math.abs(xAct));
      const actEnvNeg = asym(-actEnvPos);
      allActuals.push({ symbol: sym, xAct, yAct, act_env_pos: actEnvPos, act_env_neg: actEnvNeg });
    });

    // Attach val_raw / val_avg / val_min / val_max
    if (validPts.length > 0) {
      const valRescaled = validPts
        .map(vp => ({ x: p4(vp.x - t0), y: p4(vp.y - p0) }))
        .sort((a, b) => a.x - b.x);

      const interpAt = (pts, targetX) => {
        if (!pts.length) return p4(0);
        let lo = null, hi = null;
        for (let i = pts.length - 1; i >= 0; i--) { if (pts[i].x <= targetX) { lo = pts[i]; break; } }
        for (let i = 0; i < pts.length; i++)       { if (pts[i].x >= targetX) { hi = pts[i]; break; } }
        if (lo && hi && lo.x === hi.x) return p4(lo.y);
        if (!lo && !hi) return p4(0);
        if (!lo) { const t = hi.x > 0 ? targetX / hi.x : 0; return p4(t * hi.y); }
        if (!hi) return p4(lo.y);
        const t = (targetX - lo.x) / (hi.x - lo.x);
        return p4(lo.y + t * (hi.y - lo.y));
      };

      allOut.forEach(row => {
        if (row.symbol !== sym || row.cx === null) return;
        const cxVal = row.cx;
        row.val_raw = interpAt(valRescaled, cxVal);
        const inRange = valRescaled.filter(vp => vp.x > 0 && vp.x <= cxVal);
        if (inRange.length > 0) {
          const yArr = inRange.map(vp => vp.y).sort((a, b) => a - b);
          const mn   = yArr.reduce((s, v) => s + v, 0) / yArr.length;
          const med  = yArr.length % 2 === 0
            ? (yArr[yArr.length / 2 - 1] + yArr[yArr.length / 2]) / 2
            : yArr[Math.floor(yArr.length / 2)];
          row.val_avg = p4((mn + med) / 2);
          row.val_min = p4(Math.min(...yArr));
          row.val_max = p4(Math.max(...yArr));
        } else {
          const anchoredVal = interpAt(valRescaled, cxVal);
          row.val_avg = anchoredVal;
          row.val_min = anchoredVal;
          row.val_max = anchoredVal;
        }
      });
    }
  });

  // ── Balance output per symbol (compression / expansion) ──────────────────
  // Last step — ensures no symbol over-represents the dataset downstream.
  const balComp   = cfg.compression   || 'Off';
  const balTarget = cfg.sample_target || 'Off';
  const balOver   = (cfg.oversample   || 'Off') === 'On';

  const balancedOut = allOut.length > 1 ? balanceRows({
    rows:         allOut,
    keyField:     symF,              // matches sym_field config (default 'symbol')
    compression:  balComp,
    sampleTarget: balTarget,
    oversample:   balOver,
    sortFn:       (a, b) => (a.cx ?? 0) - (b.cx ?? 0),  // sort by convergence x
    gapFn:        (a, b) => Math.abs((b.cx ?? 0) - (a.cx ?? 0)),
    interpFn:     (a, b) => {
      // Midpoint interpolation: numerics averaged, strings from 'a'
      const mid = {};
      Object.keys(a).forEach(k => {
        if (k.startsWith('_')) { mid[k] = a[k]; return; }
        const av = Number(a[k]), bv = Number(b[k]);
        mid[k] = (!isNaN(av) && !isNaN(bv)) ? p4((av + bv) / 2) : a[k];
      });
      return mid;
    },
  }) : allOut;

  // ── Cap output rows (random sample if over threshold) ────────────────────
  const maxRows = parseInt(cfg.max_rows || '120000') || 120000;
  const finalOut = balancedOut.length > maxRows
    ? (() => {
        const arr = [...balancedOut];
        // Fisher-Yates partial shuffle to pick maxRows random rows
        for (let i = arr.length - 1; i > arr.length - 1 - maxRows; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr.slice(arr.length - maxRows);
      })()
    : balancedOut;

  if (finalOut.length) setHeaders(Object.keys(finalOut[0]).filter(k => !k.startsWith('_')));
  return {
    features: finalOut,
    _rows:    finalOut,
    actuals:  allActuals,
    _headers_actuals: allActuals.length
      ? Object.keys(allActuals[0]).filter(k => !k.startsWith('_'))
      : [],
  };
}

// ── asym_damp ─────────────────────────────────────────────────────────────────
export function runAsymDamp(node, { cfg, inputs, setHeaders }) {
  const data     = normalize(inputs.data || []);
  const field    = cfg.field    || 'cy';
  const outField = cfg.out_field || 'cy_d';
  const out = data.map(row => {
    const v = Number(row[field]);
    if (isNaN(v)) return { ...row, [outField]: null };
    const damp = v >= 0 ? 1 - Math.exp(-v) : -(1 - Math.exp(v));
    return { ...row, [outField]: p4(damp) };
  });
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── dyn_envelope ──────────────────────────────────────────────────────────────
export function runDynEnvelope(node, { cfg, inputs, setHeaders }) {
  const data  = normalize(inputs.data || []);
  const apply = normalize(inputs.apply || []);
  const src   = data.length ? data : apply;
  if (!src.length) return { data: [], _rows: [] };
  const yF    = cfg.y_field || 'p_rel';
  const symF  = cfg.sym_field || 'symbol';
  const out   = (apply.length ? apply : src).map(row => ({ ...row }));
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── outlier_clean ─────────────────────────────────────────────────────────────
export function runOutlierClean(node, { cfg, inputs, setHeaders }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };
  const yF     = cfg.y_field  || '';
  const method = cfg.method   || 'iqr';
  const thr    = parseFloat(cfg.threshold || '2.5');
  const winPct = parseFloat((cfg.win_pct || '100%').replace('%',''))/100;
  if (!yF) {
    if (data.length) setHeaders(Object.keys(data[0]).filter(k=>!k.startsWith('_')));
    return { data, _rows: data };
  }
  const vals   = data.map(r=>Number(r[yF])).filter(v=>!isNaN(v));
  const sorted = [...vals].sort((a,b)=>a-b);
  let lower=-Infinity, upper=Infinity;
  if (method==='iqr') {
    const q1=sorted[Math.floor(sorted.length*0.25)]??sorted[0];
    const q3=sorted[Math.floor(sorted.length*0.75)]??sorted[sorted.length-1];
    const iqr=q3-q1;
    lower=q1-thr*iqr; upper=q3+thr*iqr;
  } else if (method==='zscore') {
    const m=mean(vals)||0, s=stddev(vals)||1;
    lower=m-thr*s; upper=m+thr*s;
  } else if (method==='mad') {
    const m=median(vals)||0;
    const mads=[...vals.map(v=>Math.abs(v-m))].sort((a,b)=>a-b);
    const mad=median(mads)||1;
    lower=m-thr*mad*1.4826; upper=m+thr*mad*1.4826;
  }
  const out = data.filter(row=>{const v=Number(row[yF]);return isNaN(v)||( v>=lower&&v<=upper);});
  if (out.length) setHeaders(Object.keys(out[0]).filter(k=>!k.startsWith('_')));
  return { data: out, _rows: out };
}

// ── for_each ──────────────────────────────────────────────────────────────────
export async function runForEach(node, { cfg, inputs, setHeaders, callModuleCtx }) {
  const data = normalize(inputs.data || []);
  if (!data.length) return { data: [], _rows: [] };

  const keyField = cfg.key_field || 'symbol';
  const fnSel    = cfg.fn_name   || '';
  if (!fnSel) throw new Error('For Each: no module or function selected');

  const { functions, callModuleInContext } = callModuleCtx;
  const isMod  = fnSel.startsWith('mod::');
  const isFn   = fnSel.startsWith('fn::');
  const modId  = isMod ? fnSel.slice(5) : null;
  const fnName = isFn  ? fnSel.slice(4) : null;

  if (isFn && !functions?.[fnName]) throw new Error(`For Each: function "${fnName}" not found`);

  // Build unique ordered key list
  const seen = new Set(), uniqueKeys = [];
  data.forEach(row => {
    const k = String(row[keyField] ?? '');
    if (k && !seen.has(k)) { seen.add(k); uniqueKeys.push(k); }
  });

  const aggregated = [];

  for (const keyVal of uniqueKeys) {
    const subset = data.filter(row => String(row[keyField] ?? '') === keyVal);
    let iterRows = [];

    if (isMod) {
      // Build a synthetic context: inner module config is everything on the
      // for_each node's config EXCEPT the for_each-specific keys
      const SKIP = new Set(['key_field', 'fn_name', '_label', '_headers']);
      const innerCfg = Object.fromEntries(
        Object.entries(cfg).filter(([k]) => !SKIP.has(k) && !k.startsWith('_'))
      );
      const innerHeaders = [];
      const innerNode = { id: `${node.id}_fe_${modId}`, moduleId: modId };
      const innerInputs = { data: subset };

      // callModuleInContext handles mod:: by constructing a ctx and calling callModule
      iterRows = await callModuleInContext(fnSel, subset, innerCfg, innerNode, innerInputs, innerHeaders);
    } else if (isFn) {
      iterRows = await callModuleInContext(fnSel, subset, cfg, node);
    }

    // Attach the key field to every output row (preserves identity)
    iterRows.forEach(r => aggregated.push({ [keyField]: keyVal, ...r }));
  }

  if (aggregated.length) setHeaders(Object.keys(aggregated[0]).filter(k => !k.startsWith('_')));
  return { data: aggregated, _rows: aggregated };
}
