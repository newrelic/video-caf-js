var path = require('path');
var webpack = require('webpack');
var TerserPlugin = require('terser-webpack-plugin');

var pkg = require('./package.json');
var license =
  '@license ' +
  pkg.license +
  '\n' +
  pkg.name +
  ' ' +
  pkg.version +
  '\nCopyright New Relic <http://newrelic.com/>' +
  '\n@author ' +
  pkg.author;

const babelCjs = {
  test: /\.(js|mjs|cjs)$/,
  exclude: /node_modules/,
  use: { loader: 'babel-loader', options: { presets: [['@babel/preset-env', { targets: 'defaults' }]] } },
};

const babelEsm = {
  test: /\.(js|mjs|cjs)$/,
  exclude: /node_modules/,
  use: { loader: 'babel-loader', options: { presets: [['@babel/preset-env', { targets: 'defaults', modules: false }]] } },
};

const banner = new webpack.BannerPlugin({ banner: license, entryOnly: true });
const terser = new TerserPlugin();

module.exports = [
  // UMD (full bundle)
  {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, './dist/umd'),
      filename: 'newrelic-video-caf.min.js',
      library: 'CAFTracker',
      libraryTarget: 'umd',
      libraryExport: 'default',
    },
    devtool: 'source-map',
    module: {
      rules: [{ test: /\.(?:js|mjs|cjs)$/, exclude: /node_modules/, use: { loader: 'babel-loader', options: { presets: [['@babel/preset-env']] } } }],
    },
    plugins: [banner],
  },
  // CJS (full bundle)
  {
    entry: './src/index.js',
    output: { path: path.resolve(__dirname, './dist/cjs'), filename: 'index.js', libraryTarget: 'commonjs2' },
    devtool: 'source-map',
    module: { rules: [babelCjs] },
    optimization: { minimize: true, minimizer: [terser] },
    plugins: [banner],
  },
  // ESM (full bundle)
  {
    entry: './src/index.js',
    output: { path: path.resolve(__dirname, './dist/esm'), filename: 'index.js', library: { type: 'module' } },
    experiments: { outputModule: true },
    devtool: 'source-map',
    module: { rules: [babelEsm] },
    optimization: { minimize: true, minimizer: [terser] },
    plugins: [banner],
  },

  // BROWSER ENTRY — resolve.alias rewires @newrelic/video-core -> browser subpath
  // CJS
  {
    entry: './src/entry-browser.js',
    output: { path: path.resolve(__dirname, './dist/cjs/browser'), filename: 'index.js', libraryTarget: 'commonjs2' },
    resolve: { alias: { '@newrelic/video-core$': require.resolve('@newrelic/video-core/browser') } },
    devtool: 'source-map',
    module: { rules: [babelCjs] },
    optimization: { minimize: true, minimizer: [terser] },
    plugins: [banner],
  },
  // ESM
  {
    entry: './src/entry-browser.js',
    output: { path: path.resolve(__dirname, './dist/esm/browser'), filename: 'index.js', library: { type: 'module' } },
    resolve: { alias: { '@newrelic/video-core$': require.resolve('@newrelic/video-core/browser') } },
    experiments: { outputModule: true },
    devtool: 'source-map',
    module: { rules: [babelEsm] },
    optimization: { minimize: true, minimizer: [terser] },
    plugins: [banner],
  },
];
