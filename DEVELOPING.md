[![New Relic Experimental header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/#new-relic-experimental)


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
<script src="../dist/newrelic-caf.min.js"></script>
```

> If `dist` folder is not included, run `npm i && npm run build` to build it.


## Configuration

To use the CAF tracker, you need the following:

1. **ACCOUNT ID**: This is the New Relic account to which you want to send the Chromecast data. For example, in the URL `https://insights.newrelic.com/accounts/xxx`, the `xxx` represents the Account ID.

2. **APPLICATION TOKEN**: This is the token associated with the Entity you created for your application.

3. **ENDPOINT**: Specify the endpoint based on your use case. It can be `US`, `EU`, or `staging`.

### Initializing the CAF Tracker

Once you have the required credentials, initialize the CAF tracker as follows:

```javascript
nrvideo.Core.addTracker(new nrvideo.CAFTracker(receiverContext, authCredentials = { 
    accountId: "<ACCOUNT_ID>",
    applicationToken: "<APPLICATION_TOKEN>",
    endpoint: "<ENDPOINT>"
}));
```
### Using the Tracker with Chromecast Device Emulator

To test the tracker with the Chromecast Device Emulator, follow these steps:

1. Install the Chromecast Device Emulator npm package:
    ```bash
    npm i -g chromecast-device-emulator
    ```

2. Add all the IPC messages from the sender to the `scenario.json` file.

3. Start the emulator using the following command:
    ```bash
    cde start scenario.json
    ```

## Examples

Check out the `samples` folder for complete usage examples.