[![New Relic Experimental header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/#new-relic-experimental)


# New Relic CAF Tracker

New Relic video tracking for CAF Receivers.

## Requirements

This video monitor solutions can work both, on top of New Relic's **Browser Agent** or standalone.

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

If **NOT** using the New Relic Browser Agent, add this line of code:

```javascript
nrvideo.Core.setBackend(new nrvideo.NRInsightsBackend("ACCOUNT ID", "API KEY"));
```

To initialize the backend you need an ACCOUNT ID and an API KEY.

The ACCOUNT ID indicates the New Relic account to which you would like to send the Roku data. For example, https://insights.newrelic.com/accounts/xxx. Where “xxx” is the Account ID.

To register the API Key, follow the instructions found [here](https://docs.newrelic.com/docs/telemetry-data-platform/ingest-apis/introduction-event-api/).

Finally, init the CAF tracker:

```javascript
nrvideo.Core.addTracker(new nrvideo.CAFTracker());
```

## Examples

Check out the `samples` folder for complete usage examples.

## Known Limitations

- When not using the New Relic Browser Agent, some attributes are missing, like `ASN` or `country`. See the full list [here](https://docs.newrelic.com/attribute-dictionary/?attribute_name=&events_tids%5B%5D=8302&event=PageAction).
- Due to the way the chromecast player works, when an `END` happens, the `contentSrc` attribute is incorrect.

## Support

New Relic has open-sourced this project. This project is provided AS-IS WITHOUT WARRANTY OR DEDICATED SUPPORT. Issues and contributions should be reported to the project here on GitHub.

We encourage you to bring your experiences and questions to the [Explorers Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.

## Contributing

We encourage your contributions to improve New Relic CAF Tracker! Keep in mind when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project. If you have any questions, or to execute our corporate CLA, required if your contribution is on behalf of a company, please drop us an email at opensource@newrelic.com.

**A note about vulnerabilities**

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through [HackerOne](https://hackerone.com/newrelic).

## License

New Relic CAF Tracker is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.