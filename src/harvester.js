import {DEFAULT_HARVEST_TIME, DEFAULT_BUFFER_SIZE} from './constants'

export default class NRHarvester {
  
    /**
     * Constructor
     * @param {string} licenseKey - The New Relic mobile application license key.
     * @param {object} [options] - Optional configuration for harvesting.
     * @param {number} [options.harvestInterval] - Interval in ms to send events.
     * @param {number} [options.maxBufferSize] - Max events to buffer before sending.
     */
    constructor(licenseKey, options = {}) {
      this.licenseKey = licenseKey;
      this.eventBuffer = [];
      this.harvestInterval = options.harvestInterval || DEFAULT_HARVEST_TIME; 
      this.maxBufferSize = options.maxBufferSize || DEFAULT_BUFFER_SIZE;
      this.harvestTimer = null;
  
      this.startHarvestTimer();
    }
  
    startHarvestTimer() {
      this.stopHarvestTimer(); 
      this.harvestTimer = setTimeout(() => {
        this.sendBufferedEvents();
      }, this.harvestInterval);
    }
  
    stopHarvestTimer() {
      if (this.harvestTimer) {
        clearTimeout(this.harvestTimer);
        this.harvestTimer = null;
      }
    }
  
    addEventToBuffer(eventType, attributes) {
      const event = {
        ...attributes,
        "eventType": eventType,
      };
      this.eventBuffer.push(event);
  
      if (this.eventBuffer.length >= this.maxBufferSize) {
        this.sendBufferedEvents();
      } else {
        if (!this.harvestTimer) {
          this.startHarvestTimer();
        }
      }
    }
  
    async fetchDataTokens() {
      const url = "https://mobile-collector.newrelic.com/mobile/v4/connect";
      const headers = {
        "X-App-License-Key": this.licenseKey,
        "Content-Type": "application/json",
      };
      const payload = [
        [
          "newrelic_mobile_example", 
          "1.1", 
          "com.newrelic.newrelic_mobile_example" 
        ],
        [
            "Android",
            "14", 
            "sdk_gphone64_arm64", 
            "AndroidAgent",
            "7.4.0-alpha01", 
            "b797aee6-aa69-4879-9ba3-1f4aed1a7777", 
            "", 
            "", 
            "Google",
            {
                "size": "normal",
                "platform": "Flutter", 
                "platformVersion": "1.0.8"
            }
        ]
      ];
  
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
        });
  
        if (response.ok) {
          const data = await response.json();
          return data.data_token;
        } else {
          const errorText = await response.text();
          return null;
        }
      } catch (error) {
        return null;
      }
    }

    async sendToMobileCollector(eventsToProcess) {
        const dataToken = await this.fetchDataTokens();
        if (!dataToken) {
            nrvideo.Log.error("Cannot send buffered events: data token not available.");
            return;
        }

        const payload = [
            dataToken,
            [
                "Browser", 
                "15", 
                "sdk_gphone64_arm64", 
                "CAF",
                "7.6.3", 
                "b797aee6-aa69-4879-9ba3-1f4aed1a7777",
                "", 
                "", 
                "Google", 
                {
                    "size": "normal",
                    "platform": "Native", 
                    "platformVersion": "7.6.3"
                }
            ],
            0, 
            [], 
            [], 
            [], 
            [], 
            [], 
            {},
            eventsToProcess 
        ];
    
        try {
            const response = await fetch('https://mobile-collector.newrelic.com/mobile/v3/data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-App-License-Key': this.licenseKey
            },
            body: JSON.stringify(payload)
            });
    
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to send: ${errorText}`);
            }
        } catch (error) {
            nrvideo.Log.error('Error sending custom event to mobile collector:', error);
            throw error; 
        }
    }
  
    async sendBufferedEvents() {
      this.stopHarvestTimer(); 
  
      if (this.eventBuffer.length === 0) {
        nrvideo.Log.error("No events in buffer to send.");
        this.startHarvestTimer();
        return;
      }

      const eventsToProcess = [...this.eventBuffer]; 
      this.eventBuffer = []; 
      try {
        await this.sendToMobileCollector(eventsToProcess); 
      } catch (error) {
        nrvideo.Log.error("Error during harvest process:", error);
      } finally {
        if (this.eventBuffer.length === 0) { 
          this.startHarvestTimer();
        } else {
            if (!this.harvestTimer) {
                this.startHarvestTimer();
            }
        }
      }
    }

  }
  