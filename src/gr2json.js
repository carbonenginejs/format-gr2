/**
 * Legacy gr2_json emitter and serializer.
 *
 * `emitGr2Json(fileInfo, version)` returns a plain object whose key order
 * mirrors the native emitter. `stringifyGr2Json(obj)` emits compact JSON with
 * printf("%.9g")-compatible floats. Normalized integer values are dequantized
 * with float32 reciprocals, Real16 values are already converted by reader.js, and
 * non-finite floats are serialized as 0.
 */

const fr = Math.fround;

/**
 * Member type ids whose numeric values need conversion for gr2_json output.
 */
export const GR2JSON_MEMBER_TYPES = Object.freeze({
    Real32: 10, Int8: 11, UInt8: 12, BinormalInt8: 13, NormalUInt8: 14,
    Int16: 15, UInt16: 16, BinormalInt16: 17, NormalUInt16: 18,
    Int32: 19, UInt32: 20, Real16: 21
});
const T = GR2JSON_MEMBER_TYPES;

/** Float32 reciprocal used to dequantize NormalUInt8 values. */
export const GR2JSON_INV255 = fr(1 / 255);

/** Float32 reciprocal used to dequantize NormalUInt16 values. */
export const GR2JSON_INV65535 = fr(1 / 65535);

/** Float32 reciprocal used to dequantize BinormalInt8 values. */
export const GR2JSON_INV127 = fr(1 / 127);

/** Float32 reciprocal used to dequantize BinormalInt16 values. */
export const GR2JSON_INV32767 = fr(1 / 32767);

const
    INV255 = GR2JSON_INV255,
    INV65535 = GR2JSON_INV65535,
    INV127 = GR2JSON_INV127,
    INV32767 = GR2JSON_INV32767;

/**
 * JSON-compatible value accepted by {@link stringifyGr2Json}.
 *
 * @typedef {null|boolean|number|string|JsonValue[]|{[key: string]: JsonValue}} JsonValue
 */

/**
 * Root object emitted in the legacy `gr2_json` shape.
 *
 * @typedef {object} Gr2JsonRoot
 * @property {number} grannyFileFormatRevision Granny file format revision.
 * @property {string} grannyFileSource Original source filename, or an empty string.
 * @property {object[]} meshes Mesh records with deinterleaved vertex channels.
 * @property {object[]} models Model records with skeleton and mesh bindings.
 * @property {object[]} animations Animation records and transform tracks.
 */

/**
 * Convert a reflected numeric value to the float convention used by gr2_json.
 *
 * @param {number} v Raw reflected numeric value.
 * @param {number} memberType Granny member type id.
 * @returns {number} Converted and float32-rounded value.
 */
function convert(v, memberType)
{
    switch (memberType)
    {
        case T.NormalUInt8:
            return fr(v * INV255);

        case T.NormalUInt16:
            return fr(v * INV65535);

        case T.BinormalInt8:
            return fr(v * INV127);

        case T.BinormalInt16:
            return fr(v * INV32767);

        default:
            return fr(v);
    }
}

/**
 * Replace non-finite JSON numbers with zero, matching the legacy emitter.
 *
 * @param {number} v Candidate numeric value.
 * @returns {number} The original finite value, or zero.
 */
function sf(v) { return Number.isFinite(v) ? v : 0; }

/**
 * Copy and dequantize one vertex channel from reflected vertex objects.
 *
 * Missing Granny members return an empty channel.
 *
 * @param {object[]} vertices Reflected vertex array with non-enumerable type metadata.
 * @param {string} memberName Granny vertex member name to copy.
 * @param {number} destWidth Number of components in the emitted channel.
 * @returns {number[]} Flat deinterleaved channel values.
 */
function copyChannel(vertices, memberName, destWidth)
{
    const
        type = vertices.__type || [],
        m = type.find(x => x.name === memberName);
    if (!m) return [];
    const
        srcWidth = m.arrayWidth > 1 ? m.arrayWidth : 1,
        n = Math.min(srcWidth, destWidth),
        out = new Array(vertices.length * destWidth).fill(0);
    for (let i = 0; i < vertices.length; i++)
    {
        const
            raw = vertices[i][memberName],
            arr = Array.isArray(raw) ? raw : [ raw ],
            base = i * destWidth;
        for (let k = 0; k < n; k++)
        {
            out[base + k] = sf(convert(arr[k], m.type));
        }
    }
    return out;
}

/**
 * Flatten reflected scalar-array wrappers into plain JavaScript values.
 *
 * @param {ArrayLike<any>} a Reflected scalar array or already-flat array.
 * @returns {any[]} Plain scalar values.
 */
function scalarArray(a)
{
    if (!a || !a.length) return [];
    if (typeof a[0] === "object" && a[0] !== null)
    {
        const k = Object.keys(a[0])[0];
        return a.map(x => x[k]);
    }
    return a;
}

/**
 * Granny curve format ids emitted by the legacy gr2_json curve serializer.
 */
export const GR2JSON_CURVE_FORMATS = Object.freeze({
    DaKeyframes32f: 0, DaK32fC32f: 1, DaIdentity: 2, DaConstant32f: 3,
    D3Constant32f: 4, D4Constant32f: 5, DaK16uC16u: 6, DaK8uC8u: 7,
    D4nK16uC15u: 8, D4nK8uC7u: 9, D3K16uC16u: 10, D3K8uC8u: 11,
    D9I1K16uC16u: 12, D9I3K16uC16u: 13, D9I1K8uC8u: 14, D9I3K8uC8u: 15,
    D3I1K32fC32f: 16, D3I1K16uC16u: 17, D3I1K8uC8u: 18
});
const F = GR2JSON_CURVE_FORMATS;

/**
 * Locate the inline curve-data header inside a reflected curve-data object.
 *
 * @param {object} cd Reflected Granny curve-data object.
 * @returns {{Format: number, Degree: number}|null} Header object when present.
 */
function curveHeader(cd)
{
    for (const k of Object.keys(cd))
    {
        if (k.startsWith("CurveDataHeader")) return cd[k];
    }
    return null;
}

/**
 * Convert a reflected scalar array to float32-rounded finite numbers.
 *
 * @param {ArrayLike<any>} a Reflected scalar array.
 * @returns {number[]} Float array.
 */
function farr(a) { return scalarArray(a).map(x => sf(fr(x))); }

/**
 * Convert a reflected scalar array to unsigned 32-bit integer values.
 *
 * @param {ArrayLike<any>} a Reflected scalar array.
 * @returns {number[]} Unsigned integer array.
 */
function uarr(a) { return scalarArray(a).map(x => x >>> 0); }

/**
 * Emit one Granny Curve2 object in legacy gr2_json form.
 *
 * @param {object} curve2 Reflected Granny curve object.
 * @returns {object} Compact curve record with format-specific fields.
 */
function emitCurve(curve2)
{
    const cd = curve2 && curve2.CurveData;
    if (!cd) return { format: 0, degree: 0, error: "no curve data" };
    const
        h = curveHeader(cd) || { Format: 0, Degree: 0 },
        format = h.Format,
        degree = h.Degree,
        o = { format, degree };
    switch (format)
    {
        case F.DaIdentity:
            break;

        case F.DaKeyframes32f:
            o.dimension = cd.Dimension;
            o.controls = farr(cd.Controls);
            break;

        case F.DaConstant32f:
            o.controls = farr(cd.Controls);
            break;

        case F.D3Constant32f:
            o.controls = (cd.Controls || [ 0, 0, 0 ]).slice(0, 3).map(x => sf(fr(x)));
            break;

        case F.D4Constant32f:
            o.controls = (cd.Controls || [ 0, 0, 0, 0 ]).slice(0, 4).map(x => sf(fr(x)));
            break;

        case F.DaK32fC32f:
            o.knots = farr(cd.Knots);
            o.controls = farr(cd.Controls);
            break;

        case F.DaK16uC16u:
        case F.DaK8uC8u:
            o.oneOverKnotScaleTrunc = cd.OneOverKnotScaleTrunc;
            o.controlScaleOffsets = farr(cd.ControlScaleOffsets);
            o.knotsControls = uarr(cd.KnotsControls);
            break;

        case F.D4nK16uC15u:
        case F.D4nK8uC7u:
            o.scaleOffsetTableEntries = cd.ScaleOffsetTableEntries;
            o.oneOverKnotScale = sf(fr(cd.OneOverKnotScale));
            o.knotsControls = uarr(cd.KnotsControls);
            break;

        case F.D3K16uC16u:
        case F.D3K8uC8u:
        case F.D3I1K16uC16u:
        case F.D3I1K8uC8u:
        case F.D9I3K16uC16u:
        case F.D9I3K8uC8u:
            o.oneOverKnotScaleTrunc = cd.OneOverKnotScaleTrunc;
            o.controlScales = (cd.ControlScales || [ 0, 0, 0 ]).map(x => sf(fr(x)));
            o.controlOffsets = (cd.ControlOffsets || [ 0, 0, 0 ]).map(x => sf(fr(x)));
            o.knotsControls = uarr(cd.KnotsControls);
            break;

        case F.D3I1K32fC32f:
            o.controlScales = (cd.ControlScales || [ 0, 0, 0 ]).map(x => sf(fr(x)));
            o.controlOffsets = (cd.ControlOffsets || [ 0, 0, 0 ]).map(x => sf(fr(x)));
            o.knotsControls = farr(cd.KnotsControls);
            break;

        case F.D9I1K16uC16u:
        case F.D9I1K8uC8u:
            o.oneOverKnotScaleTrunc = cd.OneOverKnotScaleTrunc;
            o.controlScales = [ sf(fr(cd.ControlScale)) ];
            o.controlOffsets = [ sf(fr(cd.ControlOffset)) ];
            o.knotsControls = uarr(cd.KnotsControls);
            break;

        default:
            o.error = `Unknown format ${format}`;
    }
    return o;
}

/**
 * Convert arbitrary reflected variant data to JSON-safe plain values.
 *
 * @param {any} v Reflected variant value.
 * @returns {JsonValue} JSON-compatible value.
 */
function emitVariant(v)
{
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return v.map(emitVariant);
    if (typeof v === "object")
    {
        const o = {};
        for (const k of Object.keys(v))
        {
            o[k] = emitVariant(v[k]);
        }
        return o;
    }
    if (typeof v === "number") return Number.isInteger(v) ? v : sf(fr(v));
    return v;
}

/**
 * Attach converted extended data when the reflected variant is present.
 *
 * @param {object} target Emitted gr2_json object to mutate.
 * @param {object|null|undefined} ext Reflected extended-data variant.
 * @returns {void}
 */
function addExtendedData(target, ext)
{
    if (ext !== null && ext !== undefined && typeof ext === "object")
    {
        target.extendedData = emitVariant(ext);
    }
}

/**
 * Emit a reflected Granny mesh in legacy gr2_json shape.
 *
 * @param {object} mesh Reflected Granny mesh object.
 * @returns {object} Emitted mesh record.
 */
function emitMesh(mesh)
{
    const o = {};
    o.name = mesh.Name ?? "";
    o.morphTargets = [];
    o.minBounds = [ 0, 0, 0 ];
    o.maxBounds = [ 0, 0, 0 ];

    o.boneBindings = (mesh.BoneBindings || []).map(bb => ({
        name: bb.BoneName ?? "",
        minBounds: (bb.OBBMin || [ 0, 0, 0 ]).map(x => sf(fr(x))),
        maxBounds: (bb.OBBMax || [ 0, 0, 0 ]).map(x => sf(fr(x)))
    }));

    const
        vd = mesh.PrimaryVertexData,
        verts = (vd && vd.Vertices) || [];
    o.vertex = {
        position: copyChannel(verts, "Position", 3),
        blendIndice: copyChannel(verts, "BoneIndices", 4),
        tangent: copyChannel(verts, "Tangent", 4),
        normal: copyChannel(verts, "Normal", 3),
        texcoord0: copyChannel(verts, "TextureCoordinates0", 2),
        texcoord1: copyChannel(verts, "TextureCoordinates1", 2),
        binormal: copyChannel(verts, "Binormal", 4),
        blendWeight: copyChannel(verts, "BoneWeights", 4)
    };

    const
        topo = mesh.PrimaryTopology || {},
        i32arr = scalarArray(topo.Indices),
        i16arr = scalarArray(topo.Indices16),
        groups = topo.Groups || [];
    o.indices = [];
    let indices = null, bpi = 0;
    if (i32arr.length) { indices = i32arr; bpi = 4; }
    else if (i16arr.length) { indices = i16arr.map(x => x & 0xffff); bpi = 2; }
    if (indices)
    {
        for (const g of groups)
        {
            const
                faces = new Array(g.TriCount * 3),
                start = g.TriFirst * 3;
            for (let i = 0; i < g.TriCount * 3; i++)
            {
                faces[i] = indices[start + i] >>> 0;
            }
            o.indices.push({
                name: `area_${g.MaterialIndex}`,
                bytesPerIndex: bpi,
                faces
            });
        }
    }
    return o;
}

/**
 * Emit a reflected Granny skeleton bone in legacy gr2_json shape.
 *
 * @param {object} bone Reflected Granny bone object.
 * @returns {object} Emitted bone record.
 */
function emitBone(bone)
{
    const
        t = bone.LocalTransform || bone.Transform ||
            { flags: 0, position: [ 0, 0, 0 ], orientation: [ 0, 0, 0, 1 ], scaleShear: [ 1, 0, 0, 0, 1, 0, 0, 0, 1 ] },
        o = {};
    o.name = bone.Name ?? "";
    o.parentIndex = bone.ParentIndex | 0;
    o.flag = t.flags;
    if (t.flags & 1) o.position = t.position.map(x => sf(fr(x)));
    if (t.flags & 2) o.orientation = t.orientation.map(x => sf(fr(x)));
    if (t.flags & 4) o.scaleShear = t.scaleShear.map(x => sf(fr(x)));
    addExtendedData(o, bone.ExtendedData);
    return o;
}

/**
 * Emit a reflected Granny skeleton in legacy gr2_json shape.
 *
 * @param {object|null} skel Reflected Granny skeleton object.
 * @returns {object} Emitted skeleton record.
 */
function emitSkeleton(skel)
{
    const o = {};
    o.name = skel ? (skel.Name ?? "") : "";
    o.bones = skel ? (skel.Bones || []).map(emitBone) : [];
    if (skel) addExtendedData(o, skel.ExtendedData);
    return o;
}

/**
 * Emit a reflected Granny model in legacy gr2_json shape.
 *
 * @param {object} model Reflected Granny model object.
 * @param {object} fileInfo Root reflected Granny file-info object.
 * @returns {object} Emitted model record.
 */
function emitModel(model, fileInfo)
{
    const o = {};
    o.name = model.Name ?? "";
    o.skeleton = emitSkeleton(model.Skeleton);
    const meshes = fileInfo.Meshes || [];
    o.meshBindings = (model.MeshBindings || []).map(mb =>
    {
        const idx = meshes.indexOf(mb && mb.Mesh);
        return idx;
    });
    addExtendedData(o, model.ExtendedData);
    return o;
}

/**
 * Emit a reflected Granny transform track in legacy gr2_json shape.
 *
 * @param {object} tt Reflected Granny transform-track object.
 * @returns {object} Emitted transform-track record.
 */
function emitTransformTrack(tt)
{
    return {
        name: tt.Name ?? "",
        flags: tt.Flags | 0,
        orientation: emitCurve(tt.OrientationCurve),
        position: emitCurve(tt.PositionCurve),
        scaleShear: emitCurve(tt.ScaleShearCurve)
    };
}

/**
 * Emit a reflected Granny track group in legacy gr2_json shape.
 *
 * @param {object} tg Reflected Granny track-group object.
 * @returns {object} Emitted track-group record.
 */
function emitTrackGroup(tg)
{
    return {
        name: tg.Name ?? "",
        transformTracks: (tg.TransformTracks || []).map(emitTransformTrack)
    };
}

/**
 * Emit a reflected Granny animation in legacy gr2_json shape.
 *
 * @param {object} anim Reflected Granny animation object.
 * @returns {object} Emitted animation record.
 */
function emitAnimation(anim)
{
    const o = {};
    o.name = anim.Name ?? "";
    o.duration = sf(fr(anim.Duration));
    o.timeStep = sf(fr(anim.TimeStep));
    o.oversampling = sf(fr(anim.Oversampling));
    o.defaultLoopCount = anim.DefaultLoopCount | 0;
    o.flags = anim.Flags | 0;
    o.trackGroups = (anim.TrackGroups || []).filter(t => t).map(emitTrackGroup);
    addExtendedData(o, anim.ExtendedData);
    return o;
}

/**
 * Convert a reflected `granny_file_info` graph into the legacy `gr2_json` object.
 *
 * The key order and numeric conversion rules intentionally match the native
 * `evegr2tojson` output so downstream tools can compare serialized output.
 *
 * @param {object} fileInfo Reflected `granny_file_info` object from `reader.js`.
 * @param {number} version Granny file format revision.
 * @returns {Gr2JsonRoot} Plain JSON-compatible `gr2_json` object.
 */
export function emitGr2Json(fileInfo, version)
{
    return {
        grannyFileFormatRevision: version | 0,
        grannyFileSource: fileInfo.FromFileName ?? "",
        meshes: (fileInfo.Meshes || []).filter(m => m).map(emitMesh),
        models: (fileInfo.Models || []).filter(m => m).map(m => emitModel(m, fileInfo)),
        animations: (fileInfo.Animations || []).filter(a => a).map(emitAnimation)
    };
}

/**
 * Extract exact decimal digits for printf-style significant-digit rounding.
 *
 * @param {number} v Finite JavaScript number.
 * @returns {{neg: boolean, digits: string, exp10: number}} Exact decimal digit metadata.
 */
function exactDigits(v)
{
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v);
    const
        hi = dv.getUint32(0),
        lo = dv.getUint32(4),
        neg = !!(hi >>> 31),
        be = (hi >>> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let e2;
    if (be === 0) { e2 = -1074; }
    else { mant |= 1n << 52n; e2 = be - 1075; }
    let intPart, fracDigits = "";
    if (e2 >= 0)
    {
        intPart = (mant << BigInt(e2)).toString();
    }
    else
    {
        const
            k = -e2,
            scaled = mant * (5n ** BigInt(k));
        let s = scaled.toString().padStart(k + 1, "0");
        intPart = s.slice(0, s.length - k) || "0";
        fracDigits = s.slice(s.length - k);
    }
    let all = (intPart + fracDigits).replace(/^0+/, "");
    const exp10 = intPart.replace(/^0+/, "").length > 0
        ? intPart.replace(/^0+/, "").length - 1
        : -(fracDigits.length - fracDigits.replace(/^0+/, "").length) - 1;
    all = all.replace(/0+$/, "") || "0";
    return { neg, digits: all, exp10 };
}

/**
 * Format a finite number with C `printf("%.9g")`-compatible rounding.
 *
 * Non-finite values are serialized as `0`, matching the legacy JSON emitter.
 *
 * @param {number} v Number to format.
 * @returns {string} Decimal representation using at most 9 significant digits.
 */
export function g9(v)
{
    if (!Number.isFinite(v)) v = 0;
    if (v === 0) return Object.is(v, -0) ? "-0" : "0";
    const P = 9;
    let { neg, digits, exp10 } = exactDigits(v);

    if (digits.length > P)
    {
        const
            keep = digits.slice(0, P),
            rest = digits.slice(P);
        let roundUp = false;
        if (rest[0] > "5") roundUp = true;
        else if (rest[0] === "5")
        {
            if (/[1-9]/.test(rest.slice(1))) roundUp = true;
            else roundUp = (keep.charCodeAt(P - 1) - 48) % 2 === 1;
        }
        if (roundUp)
        {
            let arr = keep.split(""), i = P - 1;
            for (;;)
            {
                if (arr[i] === "9") { arr[i] = "0"; i--; if (i < 0) { arr.unshift("1"); exp10++; break; } }
                else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); break; }
            }
            digits = arr.join("");
        }
        else digits = keep;
    }
    digits = digits.replace(/0+$/, "") || "0";
    const sign = neg ? "-" : "";

    if (exp10 < -4 || exp10 >= P)
    {
        const
            m = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits,
            es = exp10 < 0 ? "-" : "+";
        return `${sign}${m}e${es}${Math.abs(exp10).toString().padStart(2, "0")}`;
    }
    if (exp10 >= 0)
    {
        if (digits.length <= exp10 + 1) return sign + digits.padEnd(exp10 + 1, "0");
        return sign + digits.slice(0, exp10 + 1) + "." + digits.slice(exp10 + 1);
    }
    return sign + "0." + "0".repeat(-exp10 - 1) + digits;
}

/**
 * Serialize one JSON number using legacy integer and float formatting rules.
 *
 * @param {number} v Number to serialize.
 * @returns {string} Compact numeric token.
 */
function numStr(v)
{
    if (typeof v !== "number") return String(v);
    if (Number.isInteger(v) && !Object.is(v, -0) && Math.abs(v) < 4294967296) return String(v);
    return g9(v);
}

/**
 * Serialize a `gr2_json` value using the legacy emitter's compact formatting.
 *
 * This differs from `JSON.stringify` mainly in float formatting and duplicate
 * Granny member-name handling.
 *
 * @param {JsonValue} node Value to serialize.
 * @returns {string} Compact JSON text.
 */
export function stringifyGr2Json(node)
{
    if (node === null || node === undefined) return "null";
    if (typeof node === "number") return numStr(node);
    if (typeof node === "string") return JSON.stringify(node);
    if (typeof node === "boolean") return node ? "true" : "false";
    if (Array.isArray(node)) return "[" + node.map(stringifyGr2Json).join(",") + "]";
    const parts = [];
    for (const k of Object.keys(node))
    {
        const printed = k.includes(" ") ? k.slice(0, k.indexOf(" ")) : k;
        parts.push(JSON.stringify(printed) + ":" + stringifyGr2Json(node[k]));
    }
    return "{" + parts.join(",") + "}";
}

/**
 * Frozen convenience namespace for gr2_json emission and serialization helpers.
 *
 * The same constants and functions are also exported directly from gr2json.js.
 */
export const gr2json = Object.freeze({
    MEMBER_TYPES: GR2JSON_MEMBER_TYPES,
    CURVE_FORMATS: GR2JSON_CURVE_FORMATS,
    INV255: GR2JSON_INV255,
    INV65535: GR2JSON_INV65535,
    INV127: GR2JSON_INV127,
    INV32767: GR2JSON_INV32767,
    emit: emitGr2Json,
    emitGr2Json,
    stringify: stringifyGr2Json,
    stringifyGr2Json,
    g9
});
