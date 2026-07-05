/**
 * Exposed CarbonEngineJS-facing GR2 reader class.
 *
 * Keep this file small and reviewable: parsing, conversion, rebuild, and JSON
 * helper glue live in core/helpers.js.
 */

import { CLASS_KEYS } from "./core/json.js";
import { curves } from "./core/curves.js";
import { tangents } from "./core/tangents.js";
import {
    DEFAULT_VALUES,
    OUTPUT_JSON,
    OUTPUT_RAW,
    inspectRawGr2Result,
    normalizeValues,
    readRawInput,
    readWithValues,
    toJsonValue,
    validateClass,
    validateClassKey
} from "./core/helpers.js";

/**
 * CarbonEngineJS-facing GR2 reader.
 *
 * The Cjs prefix marks this as a JavaScript reader/construction boundary. It
 * can emit plain GR2 JSON data or hydrate caller-supplied CarbonEngineJS-style
 * classes without pretending those classes are the engine runtime itself.
 */
export class CjsGr2Reader
{
   
    #emit = DEFAULT_VALUES.emit;
    #decompressCurves = DEFAULT_VALUES.decompressCurves;
    #unpackTangents = DEFAULT_VALUES.unpackTangents;
    #rebuildMissingNormals = DEFAULT_VALUES.rebuildMissingNormals;
    #rebuildMissingTangents = DEFAULT_VALUES.rebuildMissingTangents;
    #rebuildMissingBiNormals = DEFAULT_VALUES.rebuildMissingBiNormals;
    #classes = {};

    /**
     * Create a reusable reader profile.
     *
     * @param {object} [options] Default reader/build values.
     */
    constructor(options = {})
    {
        this.SetValues(options);
    }

    /**
     * Set reader values for this reusable profile.
     *
     * @param {object} [options] Values to merge into the profile.
     * @returns {CjsGr2Reader} This reader.
     */
    SetValues(options = {})
    {
        const values = normalizeValues(this.GetValues(), options);

        this.#emit = values.emit;
        this.#decompressCurves = values.decompressCurves;
        this.#unpackTangents = values.unpackTangents;
        this.#rebuildMissingNormals = values.rebuildMissingNormals;
        this.#rebuildMissingTangents = values.rebuildMissingTangents;
        this.#rebuildMissingBiNormals = values.rebuildMissingBiNormals;
        this.#classes = values.classes;

        return this;
    }

    /**
     * Get this profile's current values, optionally with per-call overrides.
     *
     * @param {object} [options] Optional values to merge into a copy.
     * @returns {object} A copy of the effective values.
     */
    GetValues(options = {})
    {
        return normalizeValues({
            emit: this.#emit,
            decompressCurves: this.#decompressCurves,
            unpackTangents: this.#unpackTangents,
            rebuildMissingNormals: this.#rebuildMissingNormals,
            rebuildMissingTangents: this.#rebuildMissingTangents,
            rebuildMissingBiNormals: this.#rebuildMissingBiNormals,
            classes: this.#classes
        }, options);
    }

    /**
     * Set multiple GR2 JSON node constructors for this profile.
     *
     * @param {object} [classes] Map of node class keys to constructors.
     * @returns {CjsGr2Reader} This reader.
     */
    SetClasses(classes = {})
    {
        return this.SetValues({ classes });
    }

    /**
     * Set a GR2 JSON node constructor for this profile.
     *
     * @param {string} type Node class key.
     * @param {Function|null|undefined} Class Constructor to use, or nullish to delete.
     * @returns {CjsGr2Reader} This reader.
     */
    SetClass(type, Class)
    {
        validateClassKey(type);
        if (Class === null || Class === undefined)
        {
            delete this.#classes[type];
            return this;
        }

        validateClass(type, Class);
        this.#classes = { ...this.#classes, [type]: Class };
        return this;
    }

    /**
     * Get a configured GR2 JSON node constructor.
     *
     * @param {string} type Node class key.
     * @returns {Function|undefined}
     */
    GetClass(type)
    {
        validateClassKey(type);
        return this.#classes[type];
    }

    /**
     * Whether this reader has a constructor for a GR2 JSON node key.
     *
     * @param {string} type Node class key.
     * @returns {boolean}
     */
    HasClass(type)
    {
        return !!this.GetClass(type);
    }

    /**
     * Parse a .gr2 buffer and return JSON by default, classes when configured,
     * or raw reflection data when `emit` is "raw".
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @param {object} [options] Per-call values.
     * @returns {object}
     */
    Read(input, options = {})
    {
        return readWithValues(this, input, this.GetValues(options));
    }

    /**
     * Parse a .gr2 buffer into the reflected Granny object graph.
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @returns {object}
     */
    ReadRaw(input)
    {
        return readRawInput(input);
    }

    /**
     * Return a stable, lightweight summary for a GR2 buffer or raw result.
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @returns {object}
     */
    Inspect(input)
    {
        return inspectRawGr2Result(this.ReadRaw(input));
    }

    /**
     * Convert reader output to plain JSON-compatible data.
     *
     * @param {object} value Reader output to convert.
     * @returns {any} Plain JSON-compatible data.
     */
    ToJSON(value)
    {
        return toJsonValue(value);
    }

    /**
     * Static one-shot read. Static methods use camelCase by convention.
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @param {object} [options] Reader and post-processing values.
     * @returns {object}
     */
    static read(input, options = {})
    {
        return readWithValues(CjsGr2Reader, input, normalizeValues(DEFAULT_VALUES, options));
    }

    /**
     * Static one-shot raw read.
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @returns {object}
     */
    static readRaw(input)
    {
        return readRawInput(input);
    }

    /**
     * Static one-shot inspection.
     *
     * @param {Uint8Array|Buffer|object} input Raw .gr2 bytes or an existing raw read result.
     * @returns {object}
     */
    static inspect(input)
    {
        return inspectRawGr2Result(readRawInput(input));
    }

    /**
     * Static JSON-compatible conversion.
     *
     * @param {object} value Reader output to convert.
     * @returns {any} Plain JSON-compatible data.
     */
    static toJSON(value)
    {
        return toJsonValue(value);
    }

    static OUTPUT_JSON = OUTPUT_JSON;
    static OUTPUT_RAW = OUTPUT_RAW;
    static CLASS_KEYS = CLASS_KEYS;
    static curves = curves;
    static tangents = tangents;

}

export default CjsGr2Reader;
