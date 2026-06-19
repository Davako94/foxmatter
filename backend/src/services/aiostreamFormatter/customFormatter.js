'use strict';

const { BaseFormatter } = require('./baseFormatter');

class CustomFormatter extends BaseFormatter {
  constructor(nameTemplate, descriptionTemplate, ctx) {
    super({ name: nameTemplate, description: descriptionTemplate }, ctx);
  }

  static fromConfig(config, ctx) {
    return new CustomFormatter(config.name, config.description, ctx);
  }

  updateTemplate(nameTemplate, descriptionTemplate) {
    this.config = { name: nameTemplate, description: descriptionTemplate };
  }

  getTemplate() {
    return this.config;
  }
}

module.exports = { CustomFormatter };
