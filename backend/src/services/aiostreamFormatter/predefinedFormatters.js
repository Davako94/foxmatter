'use strict';

const { BaseFormatter } = require('./baseFormatter');

const BUILTIN_FORMATTER_DEFINITIONS = {
  torrentio: { name: '{stream.quality}', description: '{stream.title}' },
  torbox: { name: '{stream.resolution}', description: '{stream.filename}' },
  gdrive: { name: '{addon.name}', description: '{stream.filename}' },
  lightgdrive: { name: '{addon.name}', description: '{stream.filename}' },
  prism: { name: '{stream.quality} {stream.encode}', description: '{stream.title}' },
  tamtaro: { name: '{service.name}', description: '{stream.filename}' },
  minimalisticgdrive: { name: '{stream.filename}', description: '{stream.quality}' },
};

class TorrentioFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.torrentio, ctx); }
}
class TorboxFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.torbox, ctx); }
}
class GDriveFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.gdrive, ctx); }
}
class LightGDriveFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.lightgdrive, ctx); }
}
class PrismFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.prism, ctx); }
}
class TamtaroFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.tamtaro, ctx); }
}
class MinimalisticGdriveFormatter extends BaseFormatter {
  constructor(ctx) { super(BUILTIN_FORMATTER_DEFINITIONS.minimalisticgdrive, ctx); }
}

module.exports = {
  BUILTIN_FORMATTER_DEFINITIONS,
  TorrentioFormatter,
  TorboxFormatter,
  GDriveFormatter,
  LightGDriveFormatter,
  PrismFormatter,
  TamtaroFormatter,
  MinimalisticGdriveFormatter,
};
