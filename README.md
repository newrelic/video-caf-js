[![New Relic Experimental header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/#new-relic-experimental)


# New Relic CAF Tracker

The New Relic CAF Tracker enhances your media applications by tracking video events, playback errors, and other activities, providing comprehensive insights into performance and user interactions.

- The CAF tracker is available as a ready-to-use JavaScript snippet for easy copy-paste integration.
- New Relic CAF tracker auto-detects events emitted by Chromecast Receiver.
- For questions and feedback on this package, please visit the [Explorer's Hub](https://discuss.newrelic.com), New Relic's community support forum.
- Looking to contribute to the CAF tracker code base? See [DEVELOPING.md](./DEVELOPING.md) for instructions on building and testing the CAF tracker, and Contributors.

## Adding the CAF Tracker to Your Project

To integrate the New Relic CAF Tracker into your web application, include the CAF Tracker script in your HTML file. Here's an example:

```html
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <!-- Include the CAF Tracker script -->
        <script src="path/to/caf-tracker.js"></script>
    </head>
    <body>
        <!-- Your HTML content goes here -->
    </body>
</html>
```

## Instantiating the CAF Tracker

```javascript
// Add a CAF tracker
nrvideo.Core.addTracker(new nrvideo.CAFTracker(receiverContext, authCredentials = { 
    accountId: "<ACCOUNT_ID>",
    applicationToken: "<APPLICATION_TOKEN>",
    endpoint: "<ENDPOINT>"
}));

//For setting options
tracker.setOptions({
  customData: {
    contentTitle: 'Override Existing Title',
    customPlayerName: 'myGreatPlayer',
    customPlayerVersion: '9.4.2',
  },
});

// For setting userId
tracker.setUserId('userId');

// For Sending custom Action with Attributes
const tracker = new nrvideo.CAFTracker(receiverContext, authCredentials = { 
    accountId: "<ACCOUNT_ID>",
    applicationToken: "<APPLICATION_TOKEN>",
    endpoint: "<ENDPOINT>"
});

tracker.sendCustom('CUSTOM_ACTION', 'state time', {
  test1: 'value1',
  test2: 'value2',
});
```

## Data Model

To understand which actions and attributes are captured and emitted by the Chromecast Player under different event types, see [DataModel.md](./DATAMODEL.md).

## Support

New Relic hosts and moderates an online forum where customers can interact with New Relic employees as well as other customers to get help and share best practices. Like all official New Relic open source projects, there's a related Community topic in the New Relic [Explorer's Hub](https://discuss.newrelic.com).

We encourage you to bring your experiences and questions to the [Explorer's Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.

## Examples

Check out the `samples` folder for complete usage examples.

## Known Limitations

- Due to the way the chromecast player works, when an `END` happens, the `contentSrc` attribute is incorrect.

## Support

New Relic has open-sourced this project. Issues and contributions should be reported to the project here on GitHub.

We encourage you to bring your experiences and questions to the [Explorers Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.

## Contributing

We encourage your contributions to improve New Relic CAF Tracker! Keep in mind when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project. If you have any questions, or to execute our corporate CLA, required if your contribution is on behalf of a company, please drop us an email at opensource@newrelic.com.

**A note about vulnerabilities**

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through [HackerOne](https://hackerone.com/newrelic).

## License

New Relic CAF Tracker is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.
