/**
 * Public package entry point for gr2js.
 *
 * Exposes the high-level GR2 reader, grouped lowercase namespaces, and all
 * direct helper exports from the flattened source modules.
 */

import { readGr2Raw } from "./reader.js";
import { emitGr2Json, stringifyGr2Json } from "./gr2json.js";
import { tangents } from "./tangents.js";
import { decompressAnimationCurves } from "./curves.js";

/**
 * Default output mode: return the legacy evegr2tojson-compatible object.
 *
 * @type {"gr2_json"}
 */
export const OUTPUT_GR2_JSON = "gr2_json";

/**
 * Output mode for returning the reflected Granny object graph directly.
 *
 * @type {"raw"}
 */
export const OUTPUT_RAW = "raw";

/**
 * Options accepted by {@link readGr2}.
 *
 * @typedef {object} Gr2ReadOptions
 * @property {"gr2_json"|"raw"} [emit="gr2_json"] Output shape. "gr2_json"
 * matches the legacy evegr2tojson object; "raw" returns the reflected Granny
 * file graph.
 * @property {boolean} [decompressCurves=false] Decode compressed animation
 * curves in place, adding plain knots, controls, and dimension fields.
 * @property {boolean} [unpackTangents=false] Decode CCP packed tangent frames
 * into separate normal, tangent, and binormal vertex channels.
 */

/**
 * Reflected Granny file graph returned by readGr2(buffer, { emit: "raw" }).
 *
 * @typedef {object} RawGr2Result
 * @property {number} version Granny file format revision.
 * @property {number} secCount Number of sections in the source file.
 * @property {object} fileInfo Reflected granny_file_info object graph.
 */

/**
 * Root object emitted by readGr2(buffer) and {@link emitGr2Json}.
 *
 * @typedef {object} Gr2Json
 * @property {number} grannyFileFormatRevision Granny file format revision.
 * @property {string} grannyFileSource Original source filename when present.
 * @property {object[]} meshes Mesh records in legacy gr2_json shape.
 * @property {object[]} models Model records in legacy gr2_json shape.
 * @property {object[]} animations Animation records in legacy gr2_json shape.
 */

/**
 * Read a .gr2 file from raw bytes.
 *
 * @param {Uint8Array|Buffer} buffer Raw .gr2 bytes.
 * @param {Gr2ReadOptions} [options] Reader and post-processing options.
 * @returns {Gr2Json|RawGr2Result} A gr2_json object by default, or the raw
 * reflected graph when options.emit is "raw".
 */
export function readGr2(buffer, options = {})
{
    const { emit = OUTPUT_GR2_JSON, decompressCurves = false, unpackTangents = false } = options;

    const parsed = readGr2Raw(buffer);
    if (emit === OUTPUT_RAW) return parsed;

    if (emit !== OUTPUT_GR2_JSON)
    {
        throw new Error(`gr2js: unknown emit option "${emit}"`);
    }

    const json = emitGr2Json(parsed.fileInfo, parsed.version);

    if (decompressCurves)
    {
        decompressAnimationCurves(json);
    }

    if (unpackTangents)
    {
        for (const mesh of json.meshes || [])
        {
            tangents.unpack(mesh);
        }
    }
    return json;
}

/**
 * Frozen convenience namespace for the top-level gr2 reader helpers.
 *
 * The same functions are also exported directly from the package entry point.
 */
export const gr2 = Object.freeze({
    OUTPUT_GR2_JSON,
    OUTPUT_RAW,
    read: readGr2,
    readGr2,
    readRaw: readGr2Raw,
    readGr2Raw,
    stringify: stringifyGr2Json,
    stringifyGr2Json
});

export * from "./reader.js";
export * from "./gr2json.js";
export * from "./tangents.js";
export * from "./curves.js";
export * from "./bitknit2.js";
export * from "./oodle1.js";

/** Default export matching the {@link gr2} convenience namespace. */
export default gr2;
