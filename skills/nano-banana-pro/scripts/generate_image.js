#!/usr/bin/env node

import {
  fail,
  generateImage,
  parseArgs,
  printJson,
  requireArg,
  resolveApiKey,
  resolveOutputDir,
  resolveProxyUrl,
  normalizeResolution,
} from './_common.js'

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/generate_image.js --prompt "your image description" --filename "output.png" [--resolution 1K|2K|4K]
  node scripts/generate_image.js --prompt "edit instructions" --filename "output.png" --input-image "/path/to/input.png"

Env:
  OPENROUTER_KEY / OPENROUTER_API_KEY
  NANO_BANANA_PROXY / HTTPS_PROXY / HTTP_PROXY
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    return
  }

  const prompt = requireArg(args, 'prompt')
  const filename = requireArg(args, 'filename')
  const result = await generateImage({
    prompt,
    filename,
    inputImagePath: typeof args['input-image'] === 'string' ? args['input-image'].trim() : '',
    resolution: normalizeResolution(args.resolution, '1K'),
    apiKey: resolveApiKey(args),
    outputDir: resolveOutputDir(args),
    proxyUrl: resolveProxyUrl(args),
  })

  printJson({
    ok: true,
    mode: 'generate_image',
    prompt,
    filename,
    outputPath: result.outputPath,
    resolution: result.resolution,
    edited: result.edited,
    usedProxy: result.usedProxy,
    modelResponse: result.modelResponse,
  })
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
