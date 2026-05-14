[![Community Project header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Community_Project.png)](https://opensource.newrelic.com/oss-category/#community-project)

# New Relic CAF Tracker

[![npm version](https://badge.fury.io/js/%40newrelic%2Fvideo-caf.svg)](https://badge.fury.io/js/%40newrelic%2Fvideo-caf)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

The New Relic CAF Tracker provides comprehensive video analytics for Chromecast receiver applications built with the Cast Application Framework (CAF). Track playback events, monitor quality, identify errors, and gain deep insights into streaming performance and user experience on Chromecast devices.

## Features

- **Automatic Event Detection** - Captures CAF PlayerManager events automatically without manual instrumentation
- **Ad Break Tracking** - Full support for CAF ad breaks including quartile progress events
- **Sender User Agent** - Automatically captures the sender device user agent
- **Quality Monitoring** - Bitrate and rendition change tracking
- **Error Tracking** - Detailed error codes with CAF-specific error classification
- **Easy Integration** - NPM package or direct script include
- **QoE Metrics** - Quality of Experience aggregation for startup time, buffering, and playback quality
- **Event Segregation** - Organized event types: VideoAction, VideoAdAction, VideoErrorAction, VideoCustomAction

## Table of Contents

- [Installation](#installation)
  - [Option 1: NPM/Yarn](#option-1-install-via-npmyarn)
  - [Option 2: Direct Script Include](#option-2-direct-script-include-without-npm)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
- [Best Practices](#best-practices)
- [Configuration Options](#configuration-options)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Known Limitations](#known-limitations)
- [Support](#support)
- [Contribute](#contribute)
- [License](#license)

## Installation

### Option 1: Install via NPM/Yarn

Install the package using your preferred package manager:

**NPM:**
```bash
npm install @newrelic/video-caf
```

**Yarn:**
```bash
yarn add @newrelic/video-caf
```

### Option 2: Direct Script Include (Without NPM)

For quick integration without a build system, include the tracker directly in your receiver HTML:

```html
<!DOCTYPE html>
<html>
  <head>
    <!-- New Relic CAF Tracker -->
    <script src="path/to/newrelic-caf.min.js"></script>

    <!-- CAF Receiver SDK -->
    <script src="//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js"></script>
  </head>
  <body>
    <cast-media-player></cast-media-player>

    <script>
      const receiverContext = cast.framework.CastReceiverContext.getInstance();

      // Retrieve these credentials by following the Streaming Video & Ads onboarding steps in New Relic Browser (one.newrelic.com)
      const options = {
        info: {
          licenseKey:    'YOUR_LICENSE_KEY',
          beacon:        'YOUR_BEACON_URL',
          applicationID: 'YOUR_APPLICATION_ID',
        },
      };

      // Initialize tracker BEFORE calling receiverContext.start()
      const tracker = new CAFTracker(receiverContext, options);

      receiverContext.start();
    </script>
  </body>
</html>
```

**Setup Steps:**

1. **Get Configuration** - Visit [one.newrelic.com](https://one.newrelic.com) and follow the Streaming Video & Ads onboarding flow to get your `licenseKey`, `beacon`, and `applicationID`.
2. **Integrate** - Include the script in your receiver and initialize with your configuration **before** calling `receiverContext.start()`.

## Prerequisites

Before using the tracker, ensure you have:

- **New Relic Account** - Active New Relic account with valid credentials (`beacon`, `applicationID`, `licenseKey`)
- **CAF Receiver SDK** - The Cast Application Framework Receiver SDK loaded in your receiver page
- **Chromecast Device or Emulator** - A real Chromecast device or the [Chromecast Device Emulator](https://github.com/ajaidanial/chromecast-device-emulator) for local testing

## Usage

### Getting Your Configuration

Before initializing the tracker, obtain your New Relic configuration:

1. Log in to [one.newrelic.com](https://one.newrelic.com)
2. Navigate to the video agent onboarding flow
3. Copy your credentials: `licenseKey`, `beacon`, and `applicationID`

### Basic Setup

```javascript
import CAFTracker from '@newrelic/video-caf';

// 1. Get the CastReceiverContext singleton
const receiverContext = cast.framework.CastReceiverContext.getInstance();

// 2. Retrieve these credentials by following the Streaming Video & Ads onboarding steps in New Relic Browser (one.newrelic.com)
const options = {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'bam.nr-data.net',
    applicationID: 'YOUR_APPLICATION_ID',
  },
};

// 3. Initialize tracker BEFORE receiverContext.start()
const tracker = new CAFTracker(receiverContext, options);

// 4. Start the receiver
receiverContext.start();
```

> **Important:** The tracker must be initialized before calling `receiverContext.start()` to ensure all playback events are captured from the beginning of the session.

### Advanced Configuration

```javascript
const options = {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'YOUR_BEACON_URL',
    applicationID: 'YOUR_APPLICATION_ID',
  },
  config: {
    qoeAggregate: true,        // Enable QoE event aggregation
    qoeIntervalFactor: 2,      // Send QoE events every 2 harvest cycles
  },
  customData: {
    contentTitle:     'My Video Title',
    customPlayerName: 'MyCustomPlayer',
    customAttribute:  'customValue',
  },
};

const tracker = new CAFTracker(receiverContext, options);
```

## Best Practices

### 1. Setting `contentTitle`

The `contentTitle` attribute is populated from the media metadata title if present. For best results, explicitly set it via `customData`:

```javascript
const tracker = new CAFTracker(receiverContext, {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'YOUR_BEACON_URL',
    applicationID: 'YOUR_APPLICATION_ID',
  },
  customData: {
    contentTitle: 'My Video Title',
  },
});
```

If your content changes dynamically (e.g., a playlist or queue):

```javascript
tracker.sendOptions({
  customData: {
    contentTitle: 'New Video Title',
  },
});
```

### 2. Setting `userId`

Track analytics per user by setting a user identifier:

```javascript
// Set userId during initialization
const tracker = new CAFTracker(receiverContext, {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'YOUR_BEACON_URL',
    applicationID: 'YOUR_APPLICATION_ID',
  },
  customData: {
    userId: 'user-12345',
  },
});

// Or set userId separately after initialization
tracker.setUserId('user-12345');
```

### 3. Adding Custom Attributes

Enrich your analytics data with deployment-specific attributes:

```javascript
const tracker = new CAFTracker(receiverContext, {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'YOUR_BEACON_URL',
    applicationID: 'YOUR_APPLICATION_ID',
  },
  customData: {
    contentTitle:     videoMetadata.title,
    userId:           currentUser.id,
    subscriptionTier: 'premium',
    contentProvider:  'studio-abc',
    region:           'us-west-2',
    appVersion:       '2.1.0',
  },
});
```

**Use these attributes in New Relic queries:**

```sql
-- Analyze content starts by subscription tier
SELECT count(*) FROM VideoAction WHERE actionName = 'CONTENT_START'
FACET subscriptionTier SINCE 1 day ago

-- Monitor bitrate by region
SELECT average(contentBitrate) FROM VideoAction
FACET region SINCE 1 hour ago
```

### 4. Gradual Rollout with Feature Flags

When deploying to production, use feature flags to enable the tracker gradually. This helps you:

- Validate data collection without impacting all users
- Monitor performance impact at scale
- Catch issues before full deployment
- Control monitoring costs

```javascript
// Example using a feature flag
const rolloutPercentage = 5; // Start with 5% of users

function shouldEnableTracking(userId) {
  // Simple percentage-based rollout
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (hash % 100) < rolloutPercentage;
}

const receiverContext = cast.framework.CastReceiverContext.getInstance();

// Only initialize tracker if user is in rollout
if (shouldEnableTracking(currentUser.id)) {
  const tracker = new CAFTracker(receiverContext, {
    info: {
      licenseKey: 'YOUR_LICENSE_KEY',
      beacon: 'YOUR_BEACON_URL',
      applicationID: 'YOUR_APP_ID',
    },
    customData: {
      contentTitle: videoMetadata.title,
      userId: currentUser.id,
      rolloutGroup: `${rolloutPercentage}%`,  // Track which rollout group
    },
  });
}

receiverContext.start();
```

**Recommended Rollout Schedule:**

| Phase | Percentage | Duration | Validation |
|-------|-----------|----------|------------|
| Initial | 5% | 2-3 days | Verify data flowing to New Relic |
| Early | 15% | 3-5 days | Check data quality and performance |
| Expansion | 25% | 5-7 days | Validate across device types |
| Majority | 50% | 1-2 weeks | Monitor at scale |
| Full | 100% | Ongoing | Complete deployment |

## Configuration Options

### `options.info` (required)

| Field | Type | Description |
|-------|------|-------------|
| `licenseKey` | string | New Relic Browser license key |
| `beacon` | string | Data endpoint — use `bam.nr-data.net` |
| `applicationID` | string | New Relic application ID |

### QoE (Quality of Experience) Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `qoeAggregate` | boolean | `false` | Enable Quality of Experience event aggregation. Set to `true` to collect QoE metrics like startup time, buffering, and average bitrate. |
| `qoeIntervalFactor` | number | `1` | Controls QoE event frequency. A value of `N` sends QoE events once every N harvest cycles. Must be a positive integer. QoE events are always included on first and final harvest cycles. |

### Custom Data

Add custom attributes to all events:

```javascript
customData: {
  contentTitle:        'My Video Title',   // Override video title
  customPlayerName:    'MyPlayer',         // Custom player identifier
  customPlayerVersion: '1.0.0',           // Custom player version
  userId:              '12345',            // User identifier
  // Any additional custom attributes
}
```

> **Limit:** The maximum total number of custom attributes per event is **150**. Any attributes beyond this limit will be dropped.

> **Note:** There are special keywords reserved for default attributes (see [DATAMODEL.md](./DATAMODEL.md)). Please do not use these as custom attributes, as they will be dropped. Examples of reserved keywords include `actionName`, `contentId`, `contentTitle`, `playerName`, `playerVersion`, `viewSession`, `viewId`, and others listed in the data model documentation.

## API Reference

### Core Methods

#### `tracker.setUserId(userId)`

Set a unique identifier for the current user.

```javascript
tracker.setUserId('user-12345');
```

#### `tracker.setHarvestInterval(milliseconds)`

Configure how frequently data is sent to New Relic. Accepts values between 1000ms (1 second) and 300000ms (5 minutes).

```javascript
tracker.setHarvestInterval(30000); // Send data every 30 seconds
```

#### `tracker.sendCustom(actionName, state, attributes)`

Send a custom event with arbitrary attributes.

```javascript
tracker.sendCustom('CUSTOM_ACTION', 'state time', {
  test1: 'value1',
  test2: 'value2',
});
```

#### `tracker.sendOptions(options)`

Update custom data after initialization.

```javascript
tracker.sendOptions({
  customData: {
    contentTitle: 'New Video Title',
  },
});
```

### Example: Complete Integration

```javascript
import CAFTracker from '@newrelic/video-caf';

const receiverContext = cast.framework.CastReceiverContext.getInstance();

const tracker = new CAFTracker(receiverContext, {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'YOUR_BEACON_URL',
    applicationID: 'YOUR_APPLICATION_ID',
  },
  config: {
    qoeAggregate: true,
  },
  customData: {
    contentTitle: 'My Video',
    userId:       'user-12345',
  },
});

// Configure reporting interval
tracker.setHarvestInterval(30000);

receiverContext.start();
```

## Data Model

The tracker captures comprehensive video analytics across four event types:

- **VideoAction** — Playback events (start, pause, buffer, seek, rendition changes, heartbeats)
- **VideoAdAction** — Ad break events (ad start, quartile progress, completions)
- **VideoErrorAction** — Error events (playback failures, ad errors, network errors)
- **VideoCustomAction** — Custom events defined by your application

**Full Documentation:** See [DATAMODEL.md](./DATAMODEL.md) for the complete event and attribute reference.

## Known Limitations

- When a video `END` event fires, the `contentSrc` attribute is incorrect. This is due to how the Chromecast player clears media information before the event is emitted.

## Support

Should you need assistance with New Relic products, you are in good hands with several support channels.

If the issue has been confirmed as a bug or is a feature request, please file a GitHub issue.

### Support Channels

- [New Relic Documentation](https://docs.newrelic.com): Comprehensive guidance for using our platform
- [New Relic Community](https://discuss.newrelic.com): The best place to engage in troubleshooting questions
- [New Relic University](https://learn.newrelic.com): A range of online training for New Relic users of every level
- [New Relic Technical Support](https://support.newrelic.com): 24/7/365 ticketed support. Read more about our [Technical Support Offerings](https://docs.newrelic.com/docs/licenses/license-information/general-usage-licenses/support-plan)

### Additional Resources

- **[DATAMODEL.md](./DATAMODEL.md)** - Complete event and attribute reference
- **[DEVELOPING.md](./DEVELOPING.md)** - Building and testing instructions
- **[REVIEW.md](./REVIEW.md)** - Code review guidelines

## Contribute

We encourage your contributions to improve the New Relic CAF Tracker! Keep in mind that when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project.

If you have any questions, or to execute our corporate CLA (which is required if your contribution is on behalf of a company), drop us an email at opensource@newrelic.com.

For more details on how best to contribute, see [CONTRIBUTING.md](./CONTRIBUTING.md).

### A note about vulnerabilities

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through our [bug bounty program](https://docs.newrelic.com/docs/security/security-privacy/information-security/report-security-vulnerabilities/).

If you would like to contribute to this project, review [these guidelines](./CONTRIBUTING.md).

To all contributors, we thank you! Without your contribution, this project would not be what it is today.

## License

New Relic CAF Tracker is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.

The New Relic CAF Tracker also uses source code from third-party libraries. Full details on which libraries are used and the terms under which they are licensed can be found in the [third-party notices document](./THIRD_PARTY_NOTICES.md).
