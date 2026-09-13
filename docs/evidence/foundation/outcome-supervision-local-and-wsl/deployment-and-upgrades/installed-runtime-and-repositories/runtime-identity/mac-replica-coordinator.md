# Mac replica coordinator

The current reviewed coordinator and WSL helper use Node `84a51db2`, preserving repository mappings and conflict handling. Apply receipt: `sha256:dfe7eaae58ecf261d9ddbbf520581a999a5cd7e7e74ae94c510f946cf2ad73bc`.

The later exact-snapshot reconciliation resolved Lervo's source divergence while preserving both original bundles; Arca-next remains divergent. Lervo source-reconciliation receipt: `sha256:b8947f8b9b2af018a9d98f5b1d4c9996578ad535e6c421d0c65b5eb76de2b3c5`.

## Earlier transitions

The earlier Mac replica coordinator upgrade selected Node bundle `1d13818d` for the coordinator and its configured WSL helper. Exact preimage checks preserved repository mappings, interval, and conflict behavior. The first service bootstrap failed while unloading was settling; original bytes were restored before the reviewed transition was retried. The process was observed at PID 20618 with no restart.

- Apply receipt: `sha256:c92474e0aaf44a2974bcec794e0ef3cb93a11487d66a061b58275fc8406b52ed`.
- Process observation: `sha256:ce0fb0874037a3dac6619ea11a9c01eb61e301f66693176493059d98b7b3d904`.

After the Windows restart, new WSL commands and a direct replica snapshot request completed. The unchanged Mac coordinator was restarted to release preboot SSH operations. At that observation, Lervo and Arca-next retained byte divergence, before Lervo's later reconciliation.

An earlier reviewed transition selected Node bundle `d0a27f60` for both the coordinator and WSL helper while preserving mappings and conflict handling. The coordinator was observed running at PID 17741. Apply receipt: `sha256:87d68f2e859fde20fff8ff8568f03940c2a65367fea8d70e2895731e878816b1`.
