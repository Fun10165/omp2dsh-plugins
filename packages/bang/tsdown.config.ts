/**
 * tsdown config for @omp2dsh/bang: node half (tsc, unchanged) plus the
 * browser client bundle. The client bundle is wrapped for the DSH
 * client-plugin loader — the same closure-factory shape the official
 * packages/client/tsdown.client.ts preset emits: the bundle calls
 * window.__ModuleLoader__.load({id, factory}) and resolves externals
 * through the injected require (loader module table).
 *
 * React and the client runtime type layers stay external because the loader
 * module table owns them; everything else inlines.
 */
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@omp2dsh/bang'

/** Module specifiers the dsh web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

export default {
  name: `${PLUGIN_ID}/client`,
  // Browser bundle: lib/client.js, served by the harness at /plugins/<id>/client.js.
  entry: { client: 'src/client.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  // clean must stay off — tsc's node-half output lives in the same lib/.
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
