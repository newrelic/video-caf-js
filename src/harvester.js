import nrvideo from '@newrelic/video-core'
import {
  DEFAULT_HARVEST_TIME, DEFAULT_BUFFER_SIZE, NR_ENDPOINT, 
  DATA_TOKENS_PAYLOAD, DEVICE_INFO, CHROMECAST_METADATA,
  STAGING_MOBILE_ENDPOINT, MOBILE_ENDPOINT
} from './constants'

export default class NRHarvester {
  
    /**
     * Constructor
     * @param {string} licenseKey - The New Relic application license key.
     * @param {string} endpoint - Type of endpoint to use (e.g., 'US', 'EU', 'staging').
     * @param {object} [options] - Optional configuration for harvesting.
     */
    constructor(licenseKey, endpoint, options = {}) {
      this.licenseKey = licenseKey;
      this.endpoint = endpoint;
      this.eventBuffer = [];
      this.harvestInterval = options.harvestInterval || DEFAULT_HARVEST_TIME; 
      this.maxBufferSize = options.maxBufferSize || DEFAULT_BUFFER_SIZE;
      this.dataToken = null; 
      this.isHarvesting = false;

      this.initialiseHarvester();
    }

    async initialiseHarvester() {
      try {
        await this.fetchDataTokens();
        this.startHarvestInterval();
      } catch (error) {
        nrvideo.Log.error("Initialization error:", error);
      }
    }
  
    startHarvestInterval() {
      setInterval(() => {
        this.sendBufferedEvents();
      }, this.harvestInterval);
    }
  
    addEventToBuffer(eventType, attributes) {
      const event = {
        ...attributes,
        "eventType": eventType,
        "timestamp": Date.now(),
      };
      this.eventBuffer.push(event);
  
      if (this.eventBuffer.length >= this.maxBufferSize) {
        this.sendBufferedEvents();
      }
    }

    async fetchDataTokens(maxRetries = 10, initialDelay = 1000) {
      const url = this.endpoint === NR_ENDPOINT.STAGING
        ? `${STAGING_MOBILE_ENDPOINT}/v5/connect`
        : `${MOBILE_ENDPOINT}/v5/connect`;
    
      const headers = {
        "X-App-License-Key": this.licenseKey,
        "Content-Type": "application/json",
      };
      const payload = DATA_TOKENS_PAYLOAD;
      let attempt = 0;
      let delay = initialDelay;
    
      while (attempt < maxRetries) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload),
          });
    
          if (response.ok) {
            const data = await response.json();
            this.dataToken = data.data_token;
            return; 
          } else {
            const errorText = await response.text();
            nrvideo.Log.error(`Failed to fetch data token: ${errorText}`);
          }
        } catch (error) {
          nrvideo.Log.error(`Error in fetching data token: ${error}`);
        }
    
        attempt += 1;
        if (attempt < maxRetries) {
          // Exponential backoff
          nrvideo.Log.debug(`Retrying fetchDataTokens - attempt ${attempt} in ${delay} ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for the next attempt
        } else {
          nrvideo.Log.error(`Max retries reached (${maxRetries}).`);
        }
      }
    }

    async sendToMobileCollector(eventsToProcess) {
      const url = this.endpoint === NR_ENDPOINT.STAGING
              ? `${STAGING_MOBILE_ENDPOINT}/v3/data`
              : `${MOBILE_ENDPOINT}/v3/data`
      const payload = [
          this.dataToken,
          DEVICE_INFO,
          0, 
          [], 
          [], 
          [], 
          [], 
          [], 
          CHROMECAST_METADATA,
          eventsToProcess 
      ];
    
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'X-App-License-Key': this.licenseKey
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          return response.json();
        } else {
          throw new Error(`Failed to send events: ${response.statusText}`);
        }
      } catch (error) {
          nrvideo.Log.error('Error sending custom event to mobile collector:', error);
          throw error; 
      }
    }
  
    sendBufferedEvents() {
      if (this.isHarvesting) {
        nrvideo.Log.error("Harvesting is still in progress.");
        return;
      }

      if (this.eventBuffer.length === 0) {
        nrvideo.Log.error("No events in buffer to send.");
        return;
      }

      if (this.dataToken) {
        this.isHarvesting = true;
        const eventsToSend = [...this.eventBuffer]; 
        this.eventBuffer = [];

        this.sendToMobileCollector(eventsToSend)
          .then((response) => {
            nrvideo.Log.debug("Harvest successful. Response:", response);
            this.isHarvesting = false;
          })
          .catch((error) => {
            nrvideo.Log.error("Harvest failed, re-queueing events. Error:", error.message);
            this.eventBuffer.unshift(...eventsToSend);
            this.isHarvesting = false;
          });
      } else {
        nrvideo.Log.error("No valid data token available. Cannot send events.");
      }
    }
}
