#!/usr/bin/env node
/**
 * Command-line converter for .gr2 files.
 *
 * Usage: gr2js <input.gr2> [-o out.gr2_json] [--unpack-tangents] [--raw] [--stdout].
 * The default output path strips the input's final extension and appends .gr2_json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readGr2, stringifyGr2Json } from "../src/index.js";

const
    argv = process.argv.slice(2),
    opts = { unpackTangents: false, emit: "gr2_json" };

let input = null, out = null, toStdout = false;

for (let i = 0; i < argv.length; i++)
{
    const a = argv[i];
    if (a === "--unpack-tangents") opts.unpackTangents = true;
    else if (a === "--raw") opts.emit = "raw";
    else if (a === "--stdout") toStdout = true;
    else if (a === "-o" || a === "--out") out = argv[++i];
    else if (a === "-h" || a === "--help") { usage(); process.exit(0); }
    else if (!input) input = a;
    else { console.error(`gr2js: unexpected argument "${a}"`); process.exit(2); }
}

if (!input) { usage(); process.exit(2); }

/**
 * Print CLI usage text to stderr.
 *
 * @returns {void}
 */
function usage()
{
    console.error("usage: gr2js <input.gr2> [-o out.gr2_json] [--unpack-tangents] [--raw] [--stdout]");
}

/**
 * Build the default .gr2_json output path for an input filename.
 *
 * @param {string} p Input path.
 * @returns {string} Output path beside the input.
 */
function defaultOut(p)
{
    const dot = p.lastIndexOf(".");
    return (dot > p.lastIndexOf("/") && dot > p.lastIndexOf("\\") ? p.slice(0, dot) : p) + ".gr2_json";
}

try
{
    const
        buf = readFileSync(input),
        result = readGr2(buf, opts),
        text = opts.emit === "raw" ? JSON.stringify(result, null, 2) : stringifyGr2Json(result);

    if (toStdout) { process.stdout.write(text); }
    else
    {
        const dest = out || defaultOut(input);
        writeFileSync(dest, text);
        console.error(`gr2js: wrote ${dest} (${text.length} bytes)`);
    }
}
catch (e)
{
    console.error(`gr2js: ${e.message}`);
    process.exit(1);
}
