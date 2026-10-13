"""CV variants on the CLI side (08; leaf 4.4).

- `download` — verified downloads (SHA-256 + ETag), the content-addressed offline cache,
  staging names (`<Full_Name>_CV_<Company>.pdf`) and staging cleanup (08 §8, 18 §7.1);
- `variants` — variant lookup, generation, review (diff rendering), approve / reject and the
  headless render through a render ticket (08 §6.3, §7, PLAN C8).
"""
