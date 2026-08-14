import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.jsx'],
  outfile: 'client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  loader: { '.css': 'text' },
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/dsh-client-runtime/client',
    '@deepseek-ai/dsh-client-ui-layout/client',
    '@deepseek-ai/dsh-client-ui-sidebar/client',
    '@deepseek-ai/dsh-client-ui-conversation/client',
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-workspace-terminal",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: 'return module.exports;}});' },
  logLevel: 'info',
})
