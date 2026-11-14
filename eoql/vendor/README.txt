Vendored read-only copies (never edited). Origin:
  lib/pharos.mjs, cells.json  <- ledgers/pharos-lazy/baseline/ (frozen library, sha256 e869302b...; cells.json beside it one level up, as the library expects)
  placed/*.mjs, placed/cells.json <- ledgers/pharos-lazy/src/
The pins are checked by src/vendor.mjs before anything is imported; a mismatch is E_SOURCE.
