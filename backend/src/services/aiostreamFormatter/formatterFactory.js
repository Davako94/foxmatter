'use strict';

const { TorrentioFormatter, TorboxFormatter, GDriveFormatter, LightGDriveFormatter, MinimalisticGdriveFormatter, PrismFormatter, TamtaroFormatter } = require('./predefinedFormatters');
const { CustomFormatter } = require('./customFormatter');

function createFormatter(ctx) {
  switch (ctx?.userData?.formatter?.id) {
    case 'torrentio': return new TorrentioFormatter(ctx);
    case 'torbox': return new TorboxFormatter(ctx);
    case 'gdrive': return new GDriveFormatter(ctx);
    case 'lightgdrive': return new LightGDriveFormatter(ctx);
    case 'minimalisticgdrive': return new MinimalisticGdriveFormatter(ctx);
    case 'prism': return new PrismFormatter(ctx);
    case 'tamtaro': return new TamtaroFormatter(ctx);
    case 'custom':
      if (!ctx?.userData?.formatter?.definition) {
        throw new Error('Definition is required for custom formatter');
      }
      return CustomFormatter.fromConfig(ctx.userData.formatter.definition, ctx);
    default:
      throw new Error(`Unknown formatter type: ${ctx?.userData?.formatter?.id}`);
  }
}

module.exports = { createFormatter };
