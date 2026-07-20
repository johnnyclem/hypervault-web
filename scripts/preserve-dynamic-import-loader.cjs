module.exports = function preserveDynamicImports(source) {
  return source.replace(
    /import\(\s*(\/\* @vite-ignore \*\/)?/g,
    "import(/* webpackIgnore: true */ ",
  );
};
