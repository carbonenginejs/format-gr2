/**
 * Tangent-frame packing for EVE / CCP Granny meshes.
 *
 * CCP packs the whole tangent basis (normal, tangent, and binormal) into one
 * four-component UNorm channel named "Tangent". The four angles reconstruct two
 * unit vectors and derive the normal as their cross product. This module is the
 * verified inverse of the packed quadv5 vertex shader; see NOTICE for provenance.
 */

/** Full-turn float32 constant used by the CCP tangent-frame shader. */
export const TANGENT_TAU = 6.28318548;

/** Half-turn float32 constant used by the CCP tangent-frame shader. */
export const TANGENT_PI = 3.14159274;

const
    TAU = TANGENT_TAU,
    PI = TANGENT_PI;

/**
 * Three-component vector stored as `[x, y, z]`.
 *
 * @typedef {number[]} vec3
 */

/**
 * Four-component unsigned-normalized tangent-frame payload in `[0, 1]`.
 *
 * @typedef {number[]} PackedTangent
 */

/**
 * Decoded CCP tangent basis.
 *
 * @typedef {object} TangentFrame
 * @property {vec3} T Unit tangent vector.
 * @property {vec3} B Unit binormal vector.
 * @property {vec3} N Derived normal vector.
 * @property {boolean} null Whether the packed input was the null-frame sentinel.
 */

/**
 * Minimal `gr2_json` mesh shape used by the tangent helpers.
 *
 * @typedef {object} TangentMesh
 * @property {{position?: number[], normal?: number[], tangent?: number[], binormal?: number[]}} vertex
 * Deinterleaved vertex channels.
 */

/**
 * Cross product of two vec3 values.
 *
 * @param {vec3} a Left-hand vector.
 * @param {vec3} b Right-hand vector.
 * @returns {vec3} `a x b`.
 */
export const cross = (a, b) => [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ];

/**
 * Dot product of two vec3 values.
 *
 * @param {vec3} a Left-hand vector.
 * @param {vec3} b Right-hand vector.
 * @returns {number} `a . b`.
 */
export const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

/**
 * Clamp a number to an inclusive range.
 *
 * @param {number} v Value to clamp.
 * @param {number} lo Inclusive lower bound.
 * @param {number} hi Inclusive upper bound.
 * @returns {number} Clamped value.
 */
export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

/**
 * Packed UNorm sentinel used for vertices with no authored tangent frame.
 *
 * The source bytes are [0, 255, 0, 255], which decode to angles
 * [-pi, +pi, -pi, +pi]. Those angles produce T = B = (0, 0, -1) and N = 0.
 *
 * @type {PackedTangent}
 */
export const NULL_TANGENT_UNORM = [ 0, 1, 0, 1 ];

/**
 * Test whether a packed tangent payload is the null-frame sentinel.
 *
 * Both elevation angles sit near either side of pi, which corresponds to
 * `u[1]` and `u[3]` being near 0 or 1 in UNorm space.
 *
 * @param {PackedTangent} u Four UNorm values.
 * @returns {boolean} Whether the payload marks a missing authored frame.
 */
export function isNullTangent(u)
{
    const
        e1 = u[1],
        e3 = u[3];

    return (e1 <= 1e-3 || e1 >= 1 - 1e-3) && (e3 <= 1e-3 || e3 >= 1 - 1e-3);
}

/**
 * Decode a packed tangent frame.
 *
 * The first and third channels are azimuth angles. The second and fourth
 * channels are elevation angles for the tangent and binormal vectors.
 *
 * @param {PackedTangent} u Four UNorm values in `[0, 1]` from the mesh
 * `tangent` channel.
 * @returns {TangentFrame} Unit basis in object space.
 */
export function decodeTangentFrame(u)
{
    const
        a0 = u[0]*TAU - PI,
        a1 = u[1]*TAU - PI,
        a2 = u[2]*TAU - PI,
        a3 = u[3]*TAU - PI;

    const
        s1 = Math.abs(Math.sin(a1)),
        s3 = Math.abs(Math.sin(a3));

    const
        T = [ s1*Math.cos(a0), s1*Math.sin(a0), Math.cos(a1) ],
        B = [ s3*Math.cos(a2), s3*Math.sin(a2), Math.cos(a3) ];

    const
        sign = (a1 > 0 && a3 > 0) ? 1 : -1,
        N = cross(T, B).map(v => v * sign);

    return { T, B, N, null: (s1 < 1e-6 && s3 < 1e-6) };
}

/**
 * Encode a tangent frame back to the 4 UNorm angles (inverse of decodeTangentFrame).
 *
 * Acos produces positive elevation in [0, pi]. The sign of `a1` encodes
 * opposite handedness when the supplied normal points against `cross(T, B)`.
 *
 * @param {vec3} T Unit tangent.
 * @param {vec3} B Unit binormal.
 * @param {vec3} [N] Unit normal; only handedness versus `cross(T, B)` is used.
 * @returns {PackedTangent} Four UNorm values in `[0, 1]`.
 */
export function encodeTangentFrame(T, B, N)
{
    let a0 = Math.atan2(T[1], T[0]),
        a1 = Math.acos(clamp(T[2], -1, 1));

    const
        a2 = Math.atan2(B[1], B[0]),
        a3 = Math.acos(clamp(B[2], -1, 1));

    if (N && dot(N, cross(T, B)) < 0)
    {
        a1 = -a1;
    }

    /**
     * Convert a tangent-frame angle to an unsigned-normalized channel value.
     *
     * @param {number} a Angle in radians.
     * @returns {number} Encoded UNorm value in [0, 1].
     */
    const enc = a => clamp((a + PI) / TAU, 0, 1);
    return [ enc(a0), enc(a1), enc(a2), enc(a3) ];
}

/**
 * Count vertices from a mesh position channel.
 *
 * @param {TangentMesh} mesh Mesh to inspect.
 * @returns {number} Number of xyz vertices, or zero when positions are absent.
 */
function vertexCount(mesh)
{
    const p = mesh.vertex && mesh.vertex.position;
    return p ? (p.length / 3) | 0 : 0;
}

/**
 * Is this gr2_json mesh's tangent frame packed?
 *
 * Packed means a four-component tangent channel with no separate normal or
 * binormal data. The emitter creates empty arrays for absent channels, so empty
 * normal and binormal arrays are treated as absent.
 *
 * @param {TangentMesh} mesh Mesh to inspect.
 * @returns {boolean} Whether the mesh has CCP packed tangent frames.
 */
export function isPacked(mesh)
{
    const v = mesh.vertex;
    if (!v || !v.tangent || !v.tangent.length) return false;

    const n = vertexCount(mesh);
    if (!n) return false;

    const comps = v.tangent.length / n;

    /**
     * Test whether an emitted mesh channel is absent or empty.
     *
     * @param {ArrayLike<number>|undefined|null} a Channel array to inspect.
     * @returns {boolean} Whether the channel has no values.
     */
    const empty = a => !a || a.length === 0;
    return comps === 4 && empty(v.normal) && empty(v.binormal);
}

/**
 * Unpack a packed gr2_json mesh in place: replaces the 4-component packed `tangent`
 * with explicit `normal`, `tangent` (xyz) and `binormal` (xyz) channels.
 * Null-frame vertices get zero vectors (call generateNormals/Tangents to fill them).
 *
 * @param {TangentMesh} mesh Mesh to mutate.
 * @returns {boolean} Whether unpacking happened.
 */
export function unpackMeshTangents(mesh)
{
    if (!isPacked(mesh)) return false;

    const
        v = mesh.vertex,
        n = vertexCount(mesh),
        src = v.tangent,
        normal = new Array(n * 3),
        tangent = new Array(n * 3),
        binormal = new Array(n * 3);

    for (let i = 0; i < n; i++)
    {
        const
            u = [ src[i*4], src[i*4+1], src[i*4+2], src[i*4+3] ],
            { T, B, N, null: isNull } = decodeTangentFrame(u),
            o = i * 3;

        if (isNull)
        {
            normal[o]=normal[o+1]=normal[o+2]=0;
            tangent[o]=tangent[o+1]=tangent[o+2]=0;
            binormal[o]=binormal[o+1]=binormal[o+2]=0;
        }
        else
        {
            normal[o]=N[0];
            normal[o+1]=N[1];
            normal[o+2]=N[2];

            tangent[o]=T[0];
            tangent[o+1]=T[1];
            tangent[o+2]=T[2];

            binormal[o]=B[0];
            binormal[o+1]=B[1];
            binormal[o+2]=B[2];
        }
    }
    v.normal = normal; v.tangent = tangent; v.binormal = binormal;
    return true;
}

/**
 * Generate area-weighted vertex normals from positions and triangle indices.
 *
 * Each face normal is accumulated with magnitude proportional to twice the face
 * area, then normalized per vertex.
 *
 * @param {ArrayLike<number>} positions Flat xyz positions.
 * @param {ArrayLike<number>} indices Triangle indices, three per face.
 * @returns {Float32Array} Flat xyz normal vectors.
 */
export function generateNormals(positions, indices)
{
    const
        n = positions.length / 3,
        N = new Float32Array(positions.length);

    for (let t = 0; t < indices.length; t += 3)
    {
        const
            ia = indices[t]*3,
            ib = indices[t+1]*3,
            ic = indices[t+2]*3;

        const
            ax=positions[ia],
            ay=positions[ia+1],
            az=positions[ia+2];

        const
            e1=[ positions[ib]-ax,positions[ib+1]-ay,positions[ib+2]-az ],
            e2=[ positions[ic]-ax,positions[ic+1]-ay,positions[ic+2]-az ];

        const
            fn=cross(e1,e2);

        for (const idx of [ ia,ib,ic ])
        {
            N[idx]+=fn[0];
            N[idx+1]+=fn[1];
            N[idx+2]+=fn[2];
        }
    }

    for (let i = 0; i < n; i++)
    {
        const
            o=i*3,
            l=Math.hypot(N[o],N[o+1],N[o+2])||1;

        N[o]/=l;
        N[o+1]/=l;
        N[o+2]/=l;
    }

    return N;
}

/**
 * Per-vertex tangents from positions, normals and UVs (Lengyel's method).
 *
 * Returns xyz tangents. The final tangent is Gram-Schmidt orthogonalized against
 * the normal; binormals can be reconstructed as `cross(normal, tangent)` with
 * the appropriate handedness.
 *
 * @param {ArrayLike<number>} positions Flat xyz positions.
 * @param {ArrayLike<number>} normals Flat xyz unit normals.
 * @param {ArrayLike<number>} uvs Flat uv coordinates.
 * @param {ArrayLike<number>} indices Triangle indices, three per face.
 * @returns {Float32Array} Flat xyz tangent vectors.
 */
export function generateTangents(positions, normals, uvs, indices)
{
    const
        n = positions.length / 3,
        tan1 = new Float32Array(n*3),
        tan2 = new Float32Array(n*3);

    for (let t = 0; t < indices.length; t += 3)
    {
        const
            i0=indices[t],
            i1=indices[t+1],
            i2=indices[t+2];

        const
            p0=i0*3,
            p1=i1*3,
            p2=i2*3,
            u0=i0*2,
            u1=i1*2,
            u2=i2*2;

        const
            x1=positions[p1]-positions[p0],
            y1=positions[p1+1]-positions[p0+1],
            z1=positions[p1+2]-positions[p0+2],
            x2=positions[p2]-positions[p0],
            y2=positions[p2+1]-positions[p0+1],
            z2=positions[p2+2]-positions[p0+2];

        const
            s1=uvs[u1]-uvs[u0],
            t1=uvs[u1+1]-uvs[u0+1],
            s2=uvs[u2]-uvs[u0],
            t2=uvs[u2+1]-uvs[u0+1];

        const
            d = s1*t2 - s2*t1,
            r = d ? 1/d : 0;

        const
            sx=(t2*x1-t1*x2)*r,
            sy=(t2*y1-t1*y2)*r,
            sz=(t2*z1-t1*z2)*r;

        const
            tx=(s1*x2-s2*x1)*r,
            ty=(s1*y2-s2*y1)*r,
            tz=(s1*z2-s2*z1)*r;

        for (const p of [ p0,p1,p2 ])
        {
            tan1[p]+=sx;
            tan1[p+1]+=sy;
            tan1[p+2]+=sz;
            tan2[p]+=tx;
            tan2[p+1]+=ty;
            tan2[p+2]+=tz;
        }
    }

    const tangents = new Float32Array(n*3);
    for (let i = 0; i < n; i++)
    {
        const o=i*3;

        const
            nx=normals[o],
            ny=normals[o+1],
            nz=normals[o+2];

        const
            tx=tan1[o],
            ty=tan1[o+1],
            tz=tan1[o+2];

        const
            nd=nx*tx+ny*ty+nz*tz;

        let ox=tx-nx*nd,
            oy=ty-ny*nd,
            oz=tz-nz*nd;

        const
            l=Math.hypot(ox,oy,oz)||1;

        ox/=l;
        oy/=l;
        oz/=l;

        tangents[o]=ox;
        tangents[o+1]=oy;
        tangents[o+2]=oz;
    }

    return tangents;
}

/**
 * Frozen convenience namespace for tangent-frame packing and mesh helpers.
 *
 * The same constants and functions are also exported directly from tangents.js.
 */
export const tangents = Object.freeze({
    TAU: TANGENT_TAU,
    PI: TANGENT_PI,
    NULL_TANGENT_UNORM,
    cross,
    dot,
    clamp,
    isNull: isNullTangent,
    isNullTangent,
    decode: decodeTangentFrame,
    decodeTangentFrame,
    pack: encodeTangentFrame,
    encode: encodeTangentFrame,
    encodeTangentFrame,
    unpack: unpackMeshTangents,
    unpackMeshTangents,
    isPacked,
    generateNormals,
    generateTangents
});
