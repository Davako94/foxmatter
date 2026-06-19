'use strict';

const { parseTemplate, buildStreamContext } = require('../templateEngine');

class BaseFormatter {
  constructor(config, ctx) {
    this.config = config || { name: '', description: '' };
    this.ctx = ctx || {};
  }

  format(stream, addonConfig, userConfig) {
    const context = buildStreamContext(stream, addonConfig, userConfig);
    return {
      name: parseTemplate(this.config.name || '', context),
      description: parseTemplate(this.config.description || '', context),
    };
  }
}

module.exports = { BaseFormatter };
