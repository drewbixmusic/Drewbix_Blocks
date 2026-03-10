# Feature Engineering Pipeline Flow

## Intended Flow (with per-feature pruning)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ INITIALIZATION                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ • Parse config: dep (targets), indep (features), modifiers                   │
│ • indepSrc = features only (exclude targets & modifiers)                     │
│ • NO early screening: ALL features/modifiers enter the pipeline              │
│ • Pass 1: For each feature — base + ALL transforms, score R² vs targets      │
│ • Build featureCols + modifierCols (base + ALL transforms each)              │
│ • Pool = []                                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FOR EACH FEATURE (feature as master)                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Step A: Generate this feature's indiv candidates                      │   │
│  │   • base column + R² vs targets                                       │   │
│  │   • ALL transform types (sqrt_signed, log_signed, ...) + R²           │   │
│  │   • Add to candidate batch for this feature                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Step B: Generate this feature's co-transforms                          │   │
│  │   • feat(base|tx) × every other feature (base|tx)                      │   │
│  │   • feat(base|tx) × every modifier (base|tx)                           │   │
│  │   • multiply + divide for each pair                                    │   │
│  │   • Add to candidate batch                                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Step C: Merge batch into Pool                                         │   │
│  │   Pool = Pool ∪ this_feature_batch                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Step D: PRUNE POOL (end of feature set)                                │   │
│  │   • Drop RSQ threshold violators (avg R² < threshold)                  │   │
│  │   • Drop co-correlation violators (corr ≥ thresh → drop lower-R²)      │   │
│  │   • Pool stays trimmed; no bloat carried to next feature               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│                         [next feature]                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FINAL STEPS (after all features processed)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Final prune (RSQ threshold + co-correlation on full pool)                 │
│ 2. Sort by avg R², take top N (N = nBase × multiplier)                       │
│ 3. Build output rows                                                         │
│ 4. Duplicate detection on output (Pearson R² ≥ 0.9999 → drop lower-R²)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## What was REMOVED (correct)

- **Front-end individual RSQ screening**: No dropping of features before they get to check all their transforms
- **Best-indiv pre-selection**: No picking "best" transform before co-transforms; all transforms checked

## What MUST happen (per-feature)

- **RSQ threshold** and **co-correlation** drops at end of each feature's processing
- Pool stays small; we never carry known-violators through the pipeline
