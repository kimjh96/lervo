# Speed and accuracy

| Version | Exact pairs | Claude versus Codex duration | Token comparison | Accuracy comparison |
| --- | ---: | --- | --- | --- |
| v10 | 16 | 4.6330 times slower | Claude reported 19.85% more | Claude recall 18.75 points higher; precision 8.34 points lower |
| v11 | 8 | 332.371 s versus 91.044 s; 3.6507 times slower | Claude reported 5.56% fewer | Both 100% recall; Codex precision 4.16 points higher |
| v12, complete pairs before stopping | 8 | 3.1561 times slower | Claude reported 2.98% fewer | Both 100% recall on valid observations; Codex precision 70.84%, Claude partial precision 64.59% |
| v13 | 16 | 4.1319 times slower | Claude reported 5.97% more | Both 100% recall; Codex precision 11.04 points higher and alone passed every precision gate |
| v14, seven fully valid pairs | 7 | 338.278 s versus 104.843 s; 3.2265 times slower | Claude reported 14.44% more | Both 100% recall; Codex precision 100%, Claude precision 64.29% |
| v16 | 8 | 317.335 s versus 110.028 s; 2.8841 times slower | Claude reported 2.73% fewer | Claude recall 6.25 points higher; Codex precision 20.83 points higher, but one 50% recall observation failed |
| v17 | 8 | 356.077 s versus 119.920 s; 2.9693 times slower | Claude reported 1.72% fewer | Both 100% recall; Codex precision 16.66 points higher |
| v18 | 16 | 737.736 s versus 193.063 s; 3.8212 times slower | Claude reported 6.00% more | Both 100% recall; Codex precision 17.71 points higher |

V11 covers only the two diagnosed cases. Claude's v12 partial precision was below the 65% full-population mean gate, but unexecuted cases support no inference.
