import assert from "node:assert/strict";
import { requireVisualValues } from "../src/lib/ai/visualDevelopResult.js";
assert.throws(() => requireVisualValues({results:{},errors:{0:"Gemini ocupado"}},0,["Exposure2012"]), /ocupado/);
assert.throws(() => requireVisualValues({results:{}},0,["Exposure2012"]), /válidos/);
assert.throws(() => requireVisualValues({results:{0:{Exposure2012:null}}},0,["Exposure2012"]), /válidos/);
assert.deepEqual(requireVisualValues({results:{0:{Exposure2012:0}}},0,["Exposure2012"]),{Exposure2012:0});
assert.deepEqual(requireVisualValues({results:{0:{Exposure2012:0.4}}},0,["Exposure2012"]),{Exposure2012:0.4});
console.log("5 checks passed: failures rejected, zero and real corrections preserved");
