# Normalization-Record Relocation

A byte-preserving exact structure move relocates one current single-output normalization record from source to destination in the same durable transaction, preserving reviewed hashes and compiler provenance.

A split normalization family fails closed: a plain move lacks a reviewed mapping from multiple owned outputs to the destination.
