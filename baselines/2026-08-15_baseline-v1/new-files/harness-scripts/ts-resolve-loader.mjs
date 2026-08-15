// Node's native --experimental-strip-types does not remap NodeNext-style `./foo.js`
// specifiers to sibling `./foo.ts` source files (that remapping is normally done by tsc
// at build time). This loader adds that one fallback so run-real-pipeline.ts can import
// the real src/ tree directly, without a build step.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.endsWith('.js')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    throw err;
  }
}
