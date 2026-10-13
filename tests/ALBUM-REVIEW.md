Album regression checks

Run from the repository root after npm ci:

    node tests/album-data-review.mjs
    node tests/album-export-review.mjs

The store test also needs the optional development-only react-test-renderer 18.3.1 package matching React 18. Install it locally without changing production dependencies, then run:

    node tests/album-stability-review.mjs

These checks mock backend calls and file decoding; they exercise the actual store, export and pagination code without changing user albums or consuming AI credits.
