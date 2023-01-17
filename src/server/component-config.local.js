let explorer_config = null;
if (process.env.SHOW_EXPLORER === 'true') {
  explorer_config = {
    "mountPath": "/explorer",
    "generateOperationScopedModels": true
  }
}

module.exports = {
  "loopback-component-explorer": explorer_config
}
