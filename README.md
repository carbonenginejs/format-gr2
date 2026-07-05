# @carbonenginejs/reader-gr2

Pure-JavaScript CarbonEngineJS-facing reader for RAD Granny 3D `.gr2` files. No
`granny2.dll`, no native addons, no build step; it runs in Node and the browser.

It decodes every section-compression codec used by current EVE Online assets
(None, Oodle1, BitKnit2), reconstructs the Granny object graph by walking the
file's embedded type tree, and emits GR2 JSON or caller-supplied classes.

## Install

```sh
npm install @carbonenginejs/reader-gr2
```

## Public API

The package root exports one public class: `CjsGr2Reader`. The `Cjs` prefix
marks this as a CarbonEngineJS reader/construction boundary, not an engine
runtime class. The exposed class lives in `src/CjsGr2Reader.js`; internal read
pipeline helpers and codecs live under `src/core` so the public class surface
stays easy to review.

```js
import CjsGr2Reader from "@carbonenginejs/reader-gr2";

const reader = new CjsGr2Reader({
  emit: "json",             // "json" (default) | "raw"
  decompressCurves: false,  // opt-in: resolve compressed granny curves
  unpackTangents: false,    // opt-in: unpack packed CCP tangent frames
  rebuildMissingNormals: false,
  rebuildMissingTangents: false,
  rebuildMissingBiNormals: false,
  classes: {
    Root: CjsGr2Root,
    Mesh: CjsGr2Mesh,
    BoneBinding: CjsGr2BoneBinding,
    IndexGroup: CjsGr2IndexGroup,
    MorphTarget: CjsGr2MorphTarget,
    Model: CjsGr2Model,
    Skeleton: CjsGr2Skeleton,
    Bone: CjsGr2Bone,
    Animation: CjsGr2Animation,
    TrackGroup: CjsGr2TrackGroup,
    TransformTrack: CjsGr2TransformTrack,
    Curve: CjsGr2Curve,
  },
});

const json = reader.Read(buffer);
const summary = reader.Inspect(buffer);
const text = JSON.stringify(reader.ToJSON(json));
```

The named export is the same class for callers that prefer named imports:

```js
import { CjsGr2Reader } from "@carbonenginejs/reader-gr2";
```

## Reader Rules

- Instance methods are PascalCase because reader instances can hydrate and
  extend CarbonClasses. This keeps reader commands such as `Read`, `SetValues`,
  and `SetClass` out of the camelCase/property namespace used by Carbon data,
  avoiding collisions such as an `emit` property versus an eventual
  `emit(event)` instance method.
- Static one-shot methods are camelCase because they live on `CjsGr2Reader`
  itself, not on hydrated CarbonClass instances.
- JSON builds use `reader.Read(buffer)` or static `CjsGr2Reader.read(buffer)`.
  They return GR2 JSON by default.
- Class builds use the same read path with configured classes. Use
  `reader.SetClass(type, Class)`, `reader.SetClasses(classes)`, or pass
  `classes` in the options object.
- Instantiate `new CjsGr2Reader(options)` when the same build rules should be
  reused; static methods are allocation-free one-shot convenience wrappers.
- `ToJSON` / `toJSON` converts reader output to a JSON-compatible value. It is
  not a binary `.gr2` writer and does not return JSON text.
- Conversion options preserve authored data while changing representation, such
  as `decompressCurves` and `unpackTangents`.
- Rebuild options generate missing data from available geometry. Repairing
  existing-but-bad data is a separate future concern.
- Shared schema, decorators, registries, and type utilities belong in the future
  `@carbonenginejs/core-types` package.
- Tangent helpers stay in this package for now because unpacked CCP tangent
  frames are part of GR2 post-processing. They are expected to move to a future
  shared `@carbonenginejs/core-maths` package once that package exists.

## Options

- `emit`: `"json"` default. `"raw"` returns the reflected `granny_file_info`
  graph from the low-level reader.
- `decompressCurves`: default `false`. When `true`, every animation transform
  curve gains decoded `knots`, `controls`, and `dimension` fields while keeping
  the raw compressed fields.
- `unpackTangents`: default `false`. `true` decodes packed CCP tangent frames
  into separate `normal`, `tangent`, and `binormal` vertex channels. A function
  rule receives `{ reader, options, raw, json, mesh, meshIndex }` and must return
  `true` or `false` for that mesh.
- `rebuildMissingNormals`: default `false`. `true` generates missing `normal`
  channels from `vertex.position` and triangle indices. Missing required data
  throws.
- `rebuildMissingTangents`: default `false`. `true` generates missing `tangent`
  channels from `vertex.position`, `vertex.normal`, `vertex.texcoord0`, and
  triangle indices. Missing required data throws.
- `rebuildMissingBiNormals`: default `false`. `true` generates missing
  binormals into the current `binormal` channel from `vertex.normal` and
  `vertex.tangent`. Missing required data throws.
- Missing-channel rebuild options also accept rule functions. They receive
  `{ reader, options, raw, json, mesh, meshIndex, feature, channel }` and must
  return `true` or `false`.
- `classes`: optional for `new CjsGr2Reader(options)`, `Read`, and static
  `read`. Maps node keys to constructors that follow the class hydration
  contract below; omitted keys remain plain objects. Accepted keys are shown in
  the example above and exposed as `CjsGr2Reader.CLASS_KEYS`.

## Class Hydration Contract

Class hydration is structural and intentionally thin. For each registered key,
the reader creates an instance and assigns the same fields that would have been
written to the plain GR2 JSON object:

```js
Object.assign(new Class(), nodeFields);
```

Provided classes must be constructible with no required arguments and must allow
their GR2 JSON fields to be assigned as public writable properties or setters.
They do not need to predeclare fields, but if they do, use the names below. If a
class implements `toJSON`, `ToJSON` / `toJSON` will use it during JSON-compatible
conversion.

The class map accepted by `SetClasses(classes)` and `options.classes` can contain
only the keys in `CjsGr2Reader.CLASS_KEYS`. `SetClass(type, Class)` accepts one
of those same keys as its `type` argument.

```js
class MyMesh {
  name = "";
  vertex = null;
  indices = [];
}
```

| Class key | Assigned structure |
|---|---|
| `Root` | `grannyFileFormatRevision`, `grannyFileSource`, `meshes`, `models`, `animations` |
| `Mesh` | `name`, `morphTargets`, `minBounds`, `maxBounds`, `boneBindings`, `vertex`, `indices` |
| `BoneBinding` | `name`, `minBounds`, `maxBounds` |
| `IndexGroup` | `name`, `bytesPerIndex`, `faces` |
| `MorphTarget` | `name`, `dataIsDeltas`, `vertex` |
| `Model` | `name`, `skeleton`, `meshBindings`, optional `extendedData` |
| `Skeleton` | `name`, `bones`, optional `extendedData` |
| `Bone` | `name`, `parentIndex`, `flag`, optional `position`, `orientation`, `scaleShear`, `extendedData` |
| `Animation` | `name`, `duration`, `timeStep`, `oversampling`, `defaultLoopCount`, `flags`, `trackGroups`, optional `extendedData` |
| `TrackGroup` | `name`, `transformTracks` |
| `TransformTrack` | `name`, `flags`, `orientation`, `position`, `scaleShear` |
| `Curve` | `format`, `degree`, plus format-specific curve fields such as `dimension`, `knots`, `controls`, `oneOverKnotScaleTrunc`, `controlScaleOffsets`, `scaleOffsetTableEntries`, `oneOverKnotScale`, `controlScales`, `controlOffsets`, `knotsControls`, or `error` |

`Mesh.vertex` and `MorphTarget.vertex` are plain channel containers with flat
numeric arrays. Missing channels are empty arrays.

| Vertex field | Layout |
|---|---|
| `position` | xyz triples |
| `blendIndice` | xyzw bone-index groups |
| `tangent` | xyzw packed/authored tangents, or xyz after `unpackTangents` / rebuild |
| `normal` | xyz triples |
| `texcoord0`, `texcoord1` | uv pairs |
| `binormal` | xyzw authored binormals, or xyz after `unpackTangents` / rebuild |
| `blendWeight` | xyzw bone-weight groups |

`IndexGroup.faces` is a flat triangle-index array in groups of three.

## CLI

```sh
reader-gr2 model.gr2            # writes model.json next to the input
gr2reader model.gr2             # legacy alias
```

## Helper Namespaces

Helper namespaces are static properties on `CjsGr2Reader`:

```js
const decoded = CjsGr2Reader.curves.decode(curveJson, 4);
const unpacked = CjsGr2Reader.tangents.unpack(mesh);
```

## License / Attribution

Current license: `EUPL-1.2`.

`@carbonenginejs/reader-gr2` is currently EUPL-1.2 because `src/core/bitknit2.js` derives from
EUPL-1.2 prior work. The intended future target is MIT once that implementation
is replaced, removed, or re-derived from permissively licensed sources. See
`LICENSE`, `NOTICE`, and `THIRD-PARTY-NOTICES.md` for provenance and current
redistribution requirements.

Contains no RAD/Granny proprietary code and does not link `granny2.dll`.
