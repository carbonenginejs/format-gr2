/**
 * BitKnit2 (Granny .gr2 section format 4) decompressor.
 *
 * Ported from Knit (EUPL-1.2), which is itself derived from pybg3 (MIT), and
 * cross-checked against public BitKnit reverse-engineering notes. Input is a
 * stream of little-endian uint16 words beginning with 0x75B1. Output is
 * produced in 64 KiB quanta: a quantum starting with word 0 is stored raw;
 * otherwise it is entropy-coded with two interleaved 32-bit rANS states.
 * Adaptive command and distance models rebuild every 1024 observations.
 */

/** Magic word required at the start of a BitKnit2 stream. */
export const BITKNIT2_MAGIC = 0x75B1;

/** Number of bits in each adaptive rANS frequency table. */
export const BITKNIT2_FREQ_BITS = 15;

/** Number of high bits used for the fast symbol lookup table. */
export const BITKNIT2_LOOKUP_BITS = 10;

/** Bit shift from full rANS frequency precision to lookup-table precision; value 5. */
export const BITKNIT2_LOOKUP_SHIFT = BITKNIT2_FREQ_BITS - BITKNIT2_LOOKUP_BITS;

/** Total normalized frequency sum for every BitKnit2 model; value 0x8000. */
export const BITKNIT2_TOTAL_SUM = 1 << BITKNIT2_FREQ_BITS;

/** Number of observations between deferred adaptive model rebuilds. */
export const BITKNIT2_ADAPT_INTERVAL = 1024;

const
    FREQ_BITS = BITKNIT2_FREQ_BITS,
    LOOKUP_BITS = BITKNIT2_LOOKUP_BITS,
    LOOKUP_SHIFT = BITKNIT2_LOOKUP_SHIFT,
    TOTAL_SUM = BITKNIT2_TOTAL_SUM,
    ADAPT_INTERVAL = BITKNIT2_ADAPT_INTERVAL;

/**
 * Adaptive rANS model used by BitKnit2 command and distance streams.
 */
class Model
{
    /**
     * Create a model with the given vocabulary and minimum-probability tail.
     *
     * @param {number} vocabSize Number of symbols in the model.
     * @param {number} numMinProbable Symbols reserved for minimum-probability handling.
     */
    constructor(vocabSize, numMinProbable)
    {
        const nEqui = vocabSize - numMinProbable;
        this.vocab = vocabSize;
        this.freqIncr = ((TOTAL_SUM - vocabSize) / ADAPT_INTERVAL) | 0;
        this.lastFreqIncr = 1 + TOTAL_SUM - vocabSize - this.freqIncr * ADAPT_INTERVAL;
        this.sums = new Uint16Array(vocabSize + 1);
        this.lookup = new Uint16Array(1 << LOOKUP_BITS);
        this.acc = new Uint16Array(vocabSize).fill(1);
        this.counter = 0;
        for (let i = 0; i < nEqui; i++)
        {
            this.sums[i] = Math.floor((TOTAL_SUM - numMinProbable) * i / nEqui);
        }
        for (let i = nEqui; i <= vocabSize; i++)
        {
            this.sums[i] = TOTAL_SUM - vocabSize + i;
        }
        this.finishUpdate();
    }

    /**
     * Rebuild the fast lookup table from cumulative symbol frequencies.
     *
     * @returns {void}
     */
    finishUpdate()
    {
        const { sums, lookup } = this;
        let code = 0, sym = 0, next = sums[1];
        while (code < TOTAL_SUM)
        {
            if (code < next)
            {
                lookup[code >> LOOKUP_SHIFT] = sym;
                code += 1 << LOOKUP_SHIFT;
            }
            else
            {
                sym++;
                next = sums[sym + 1];
            }
        }
    }

    /**
     * Record a decoded symbol and periodically adapt model frequencies.
     *
     * @param {number} sym Decoded symbol index.
     * @returns {void}
     */
    observe(sym)
    {
        this.acc[sym] += this.freqIncr;
        this.counter = (this.counter + 1) & (ADAPT_INTERVAL - 1);
        if (this.counter === 0)
        {
            this.acc[sym] += this.lastFreqIncr;
            const { sums, acc, vocab } = this;
            let sum = 0;
            for (let i = 1; i <= vocab; i++)
            {
                sum += acc[i - 1];
                sums[i] = sums[i] + ((sum - sums[i]) >> 1);
                acc[i - 1] = 1;
            }
            this.finishUpdate();
        }
    }
}

/**
 * Decompress a Granny BitKnit2 (section format 4) block.
 *
 * Literals are delta-coded against the last match distance. Match commands below
 * 288 encode short lengths directly; larger commands add raw bits. Distances use
 * a recent-offset cache for low symbols and an exponent model for full offsets.
 *
 * @param {Uint8Array} bytes Compressed section payload.
 * @param {number} expandedSize Expected decompressed byte length.
 * @returns {Uint8Array} Decompressed bytes, exactly `expandedSize` long.
 * @throws {Error} If the stream magic, entropy state, or match references are invalid.
 */
export function decompressBitKnit2(bytes, expandedSize)
{
    const dst = new Uint8Array(expandedSize);
    if (expandedSize === 0) return dst;

    const
        dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        nWords = bytes.byteLength >> 1;

    let wi = 0;

    /**
     * Read the next little-endian 16-bit source word.
     *
     * @returns {number} Source word.
     * @throws {Error} If the compressed source is exhausted.
     */
    const word = () =>
    {
        if (wi >= nWords) throw new Error("BitKnit2: source underflow");
        const w = dv.getUint16(wi << 1, true);
        wi++;
        return w;
    };

    /**
     * Peek at the next little-endian 16-bit source word without advancing.
     *
     * @returns {number} Source word.
     * @throws {Error} If the compressed source is exhausted.
     */
    const peek = () =>
    {
        if (wi >= nWords) throw new Error("BitKnit2: source underflow");
        return dv.getUint16(wi << 1, true);
    };

    if (word() !== BITKNIT2_MAGIC) throw new Error("BitKnit2: bad magic");

    const
        commandModels = [
            new Model(300, 36), new Model(300, 36), new Model(300, 36), new Model(300, 36)
        ],
        cacheRefModels = [
            new Model(40, 0), new Model(40, 0), new Model(40, 0), new Model(40, 0)
        ],
        copyOffsetModel = new Model(21, 0);

    const lruEntries = new Uint32Array(8).fill(1);
    let lruOrder = 0x76543210;

    /**
     * Insert a newly decoded match distance into the recent-offset cache.
     *
     * @param {number} value Match distance to cache.
     * @returns {void}
     */
    const lruInsert = (value) =>
    {
        lruEntries[lruOrder >>> 28] = lruEntries[(lruOrder >>> 24) & 15];
        lruEntries[(lruOrder >>> 24) & 15] = value;
    };

    /**
     * Resolve and promote a recent-offset cache hit.
     *
     * @param {number} index LRU cache index from the entropy stream.
     * @returns {number} Cached match distance.
     */
    const lruHit = (index) =>
    {
        const
            slot = (lruOrder >>> (index * 4)) & 15,
            rotateMask = index === 7 ? 0xFFFFFFFF : (16 << (index * 4)) - 1,
            rotated = ((lruOrder * 16 + slot) & rotateMask) >>> 0;
        lruOrder = (((lruOrder & ~rotateMask) >>> 0) | rotated) >>> 0;
        return lruEntries[slot];
    };

    let bits1 = 0x10000,
        bits2 = 0x10000,
        deltaOffset = 1,
        offset = 0;

    /**
     * Renormalize the active rANS state from the source stream when needed.
     *
     * @returns {void}
     */
    const refill1 = () =>
    {
        if (bits1 < 0x10000) bits1 = bits1 * 65536 + word();
    };

    /**
     * Pop raw low bits from the active rANS state and swap interleaved states.
     *
     * @param {number} nbits Number of bits to read.
     * @returns {number} Decoded bit value.
     */
    const popBits = (nbits) =>
    {
        const sym = bits1 & ((1 << nbits) - 1);
        bits1 = bits1 >= 0x80000000 ? Math.floor(bits1 / (1 << nbits)) : bits1 >> nbits;
        refill1();
        const t = bits1; bits1 = bits2; bits2 = t;
        return sym;
    };

    /**
     * Decode one symbol from an adaptive rANS model and swap interleaved states.
     *
     * @param {Model} model Adaptive model to decode from.
     * @returns {number} Decoded symbol.
     */
    const popModel = (model) =>
    {
        const code = bits1 & (TOTAL_SUM - 1);
        let sym = model.lookup[code >> LOOKUP_SHIFT];
        const sums = model.sums;
        while (code >= sums[sym + 1]) sym++;

        bits1 = (bits1 >= 0x80000000 ? Math.floor(bits1 / TOTAL_SUM) : bits1 >> FREQ_BITS)
            * (sums[sym + 1] - sums[sym]) + code - sums[sym];
        refill1();
        model.observe(sym);
        const t = bits1; bits1 = bits2; bits2 = t;
        return sym;
    };

    while (offset < expandedSize)
    {
        const boundary = Math.min(expandedSize, (offset & ~0xFFFF) + 0x10000);

        if (peek() === 0)
        {
            wi++;
            const copyLength = Math.min((nWords - wi) * 2, boundary - offset);
            dst.set(bytes.subarray(wi << 1, (wi << 1) + copyLength), offset);
            offset += copyLength;
            wi += copyLength >> 1;
            continue;
        }

        {
            let merged = word() * 65536 + word();
            const split = merged & 15;
            merged = Math.floor(merged / 16);
            if (merged < 0x10000) merged = merged * 65536 + word();
            bits1 = split === 0
                ? merged
                : (merged >= 0x80000000 ? Math.floor(merged / (1 << split)) : merged >> split);
            if (bits1 < 0x10000) bits1 = bits1 * 65536 + word();
            const m = 2 ** (16 + split);
            bits2 = ((merged % 65536) * 65536 + word()) % m + m;
        }

        if (offset === 0) dst[offset++] = popBits(8);

        while (offset < boundary)
        {
            const
                phase = offset & 3,
                command = popModel(commandModels[phase]);

            if (command < 256)
            {
                dst[offset] = command + dst[offset - deltaOffset];
                offset++;
                continue;
            }

            let copyLength;
            if (command < 288)
            {
                copyLength = command - 254;
            }
            else
            {
                const nb = command - 287;
                copyLength = (1 << nb) + popBits(nb) + 32;
            }

            let copyOffset;
            const cacheRef = popModel(cacheRefModels[phase]);

            if (cacheRef < 8)
            {
                copyOffset = lruHit(cacheRef);
            }
            else
            {
                const nb = popModel(copyOffsetModel);
                let extra = popBits(nb & 15);
                if (nb >= 16) extra = extra * 65536 + word();
                copyOffset = (nb >= 27 ? 32 * 2 ** nb : 32 << nb) + extra * 32 + cacheRef - 39;
                lruInsert(copyOffset);
            }

            deltaOffset = copyOffset;
            let from = offset - copyOffset;
            if (from < 0) throw new Error("BitKnit2: match before start");
            for (let i = 0; i < copyLength; i++)
            {
                dst[offset++] = dst[from++];
            }
        }

        if (bits1 !== 0x10000 && bits2 !== 0x10000)
        {
            throw new Error("BitKnit2: rANS stream corrupted");
        }
    }

    return dst;
}

/**
 * Frozen convenience namespace for Granny BitKnit2 section decompression.
 *
 * The same constants and functions are also exported directly from bitknit2.js.
 */
export const bitknit2 = Object.freeze({
    MAGIC: BITKNIT2_MAGIC,
    FREQ_BITS: BITKNIT2_FREQ_BITS,
    LOOKUP_BITS: BITKNIT2_LOOKUP_BITS,
    LOOKUP_SHIFT: BITKNIT2_LOOKUP_SHIFT,
    TOTAL_SUM: BITKNIT2_TOTAL_SUM,
    ADAPT_INTERVAL: BITKNIT2_ADAPT_INTERVAL,
    decompress: decompressBitKnit2,
    decompressBitKnit2
});
