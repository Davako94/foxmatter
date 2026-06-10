# FoxMatter

FoxMatter is an advanced customization layer for Stremio that gives users complete control over how addon content is displayed.

Instead of being limited by the formatting choices made by addon developers, FoxMatter allows users to redefine titles, descriptions, metadata presentation, and visual badges across their installed addons through configurable profiles.

The goal is to create a unified, consistent, and highly customizable viewing experience while remaining compatible with existing Stremio addons.

---

## Features

### Custom Formatting Engine

FoxMatter can override how addon metadata is presented.

Users can create custom formatting templates for:

* Titles
* Descriptions
* Metadata fields
* Stream information
* Source information

Formatting rules can be applied globally or per addon.

Examples:

* Reorder metadata fields
* Display quality information in titles
* Highlight specific source attributes
* Standardize naming across different addons

---

### Badge System

FoxMatter introduces a powerful badge engine inspired by modern media browsers.

Badges can be automatically generated based on metadata and custom rules.

Examples:

* 4K
* HDR
* Dolby Vision
* Dolby Atmos
* Multi Audio
* New Release
* Fast Source
* Premium Source

Features:

* Multiple badges per item
* Custom priorities
* Conditional badge generation
* User-defined badge collections
* Importable and exportable badge packs

---

### JSON Import / Export

Every configuration can be exported as a JSON file and shared with other users.

Supported exports include:

* Formatting profiles
* Badge profiles
* Rule collections
* Addon mappings

Benefits:

* Easy backup
* Device synchronization
* Community sharing
* Version control

---

### Addon Mapping System

Different addons often expose metadata in different formats.

FoxMatter includes a mapping layer that allows:

* Per-addon formatting profiles
* Per-addon badge profiles
* Independent configuration management
* Custom overrides for specific addons

This makes it possible to maintain a consistent visual experience even when using multiple addon sources.

---

### Cross-Platform Compatibility

FoxMatter is designed to operate consistently across supported platforms.

Supported targets:

* Android
* Android TV
* Windows
* iOS

The architecture is platform-agnostic and focuses on maintaining identical behavior wherever possible.

---

## Architecture Overview

FoxMatter is built around several core components:

### Formatter Engine

Responsible for:

* Template processing
* Metadata transformation
* Dynamic field generation
* Rendering preparation

### Badge Engine

Responsible for:

* Badge evaluation
* Conditional rules
* Priority handling
* Badge rendering data

### Profile Manager

Responsible for:

* Configuration loading
* Profile storage
* Validation
* Migration support

### Import / Export Manager

Responsible for:

* JSON serialization
* JSON deserialization
* Version compatibility
* Backup and restore operations

### Addon Mapping Layer

Responsible for:

* Addon detection
* Profile assignment
* Override resolution
* Metadata normalization

---

## Example Use Cases

### Unified Experience

Multiple addons often expose information differently.

FoxMatter allows users to create a single formatting profile that standardizes:

* Quality labels
* Audio information
* Release details
* Source naming

---

### Custom Badge Packs

Create badge packs tailored to personal preferences:

* Minimalistic badges
* Streaming-focused badges
* Home theater badges
* Anime-specific badges
* Language-focused badges

---

### Community Sharing

Users can share:

* Formatting profiles
* Badge collections
* Rule sets
* Complete visual configurations

through simple JSON exports.

---

## Design Goals

FoxMatter is built around four primary principles:

### Consistency

Create a uniform experience across different addons.

### Flexibility

Allow complete customization without modifying original addons.

### Portability

Enable easy sharing and backup of configurations.

### Extensibility

Provide a foundation for future customization systems and advanced metadata enhancements.

---

## Roadmap

Planned improvements include:

* Visual profile editor
* Advanced conditional rules
* Community profile marketplace
* Additional metadata providers
* Enhanced badge customization
* Theme integration
* Advanced filtering systems
* Profile synchronization capabilities

---

## Status

FoxMatter is currently under active development.

The project aims to become a comprehensive customization framework for Stremio users who want greater control over how addon content is presented and organized.
