[![Community Project header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Community_Project.png)](https://opensource.newrelic.com/oss-category/#community-project)


# New Relic CAF Tracker

New Relic video tracking for CAF Receivers.

## Build

Install dependencies:

```
$ npm install
```

And build:

```
$ npm run build:dev
```

Or if you need a production build:

```
$ npm run build
```

## Usage

Load **scripts** inside `dist` folder into your page.

```html
<script src="../dist/umd/newrelic-video-caf.min.js"></script>
```

> If `dist` folder is not included, run `npm i && npm run build` to build it.


## Configuration

To use the CAF tracker, you need the following credentials from New Relic:

1. **LICENSE KEY**: Your New Relic Browser license key
2. **BEACON**: Data endpoint — use `bam.nr-data.net`
3. **APPLICATION ID**: Your New Relic application ID

Visit [one.newrelic.com](https://one.newrelic.com) and follow the Streaming Video & Ads onboarding flow to get these credentials.

### Initializing the CAF Tracker

Initialize the tracker **before** calling `receiverContext.start()`:

```javascript
const receiverContext = cast.framework.CastReceiverContext.getInstance();

const tracker = new nrvideo.CAFTracker(receiverContext, {
  info: {
    licenseKey:    'YOUR_LICENSE_KEY',
    beacon:        'bam.nr-data.net',
    applicationID: 'YOUR_APPLICATION_ID',
  },
});

receiverContext.start();
```

### Using the Tracker with Chromecast Device Emulator

To test the tracker with the Chromecast Device Emulator, follow these steps:

1. Install the Chromecast Device Emulator npm package:
    ```bash
    npm i -g chromecast-device-emulator
    ```

2. Add all the IPC messages from the sender to the `samples/scenario.json` file.

3. Start the emulator using the following command:
    ```bash
    cde start samples/scenario.json
    ```

## Examples

Check out the `samples` folder for complete usage examples.