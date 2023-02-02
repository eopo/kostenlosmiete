'use strict';

import * as cheerio from 'cheerio';
import {default as axios} from 'axios';
import {default as _} from 'lodash';
import * as webchangemon from 'webchangemon';

import * as dotenv from 'dotenv';

dotenv.config();

const URL = 'https://www.starcar.de/specials/kostenlos-mieten/';
const TARGET_MAIL = process.env.TARGET_MAIL;
const SENDER_MAIL = process.env.SENDER_MAIL;
const SMTP_STRING = process.env.SMTP_STRING;

const options = {
    getCurrentData,
    formatChange,
    compareData,
    toMail: TARGET_MAIL,
    fromMail: SENDER_MAIL,
    smtpString: SMTP_STRING,
    mailTitle: 'Starcar-Mieten',
    locale: 'de-DE',
    dataPath: 'data.json',
}

const app = webchangemon.bootstrap(options);

async function getCurrentData() {
    const response = await axios.get(URL);
    const html = response.data;
    const $ = cheerio.load(html);
    const offers = [];
    const offersList = $('#start-city').find('.offer').each((i,element) => {
        const offer = {};
        const $element = $(element).find('.klm').first()
    
        offer.freeFuel = $element.find('p:contains("1x Tank inklusive")').length > 0;
        offer.group = $element.find('.flip-box-headline1').first().text().trim();
        offer.model = $element.find('.flip-box-headline2').first().text().trim();
    
        const pickupDate = $element.find('.klm-date').first().find('.big1').text().trim();
        const pickupTime = $element.find('.klm-date').first().text().trim().split('\n')[1].trim();
        const returnDate = $element.find('.klm-date').last().find('.big1').text().trim();
        const returnTime = $element.find('.klm-date').last().text().trim().split('\n')[1].trim();
        
        offer.pickupTimestamp = convertStringToTimestamp(pickupDate, pickupTime)
        offer.returnTimestamp = convertStringToTimestamp(returnDate, returnTime)
        offer.distance = Number.parseInt($element.find('div[style="font-size: 1.1em; text-align: center;"]').text().trim().match(/\d+/)[0]);
        
        offer.pickupCity = $element.find('.headline.center-xs:not(.row)').first().children().remove().end().text().trim();
        offer.returnCity = $element.find('.headline.center-xs:not(.row)').last().children().remove().end().text().trim();
        
        offers.push(offer);
    });

    return offers;
}
  
function convertStringToTimestamp(dateString, timeString) {
    const [day,month] = dateString.split('.').map(split => (split.trim()));
    const currentMonth = new Date().getMonth();
    const year = (month < currentMonth) ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const [hour,minute] = timeString.split(':').map(split => Number.parseInt(split.trim()));
    return new Date(year, month -1, day, hour, minute).getTime();
}; 

function findSimilar(item, array){
    const propertiesFirstMatch = ['pickupCity','returnCity','group','model']

    const similarItems = _.filter(array, _.pick(item, propertiesFirstMatch));
    if (similarItems.length == 0) return false;
    if (similarItems.length == 1) return similarItems[0];
    
    const differences = _.map(similarItems, similar => {
        const differencePickup = Math.abs(similar.pickupTimestamp - item.pickupTimestamp)/1000;
        const differenceReturn = Math.abs(similar.returnTimestamp - item.returnTimestamp)/1000;
        const differnceKms = Math.abs(similar.distance - item.distance);
        const differenceFuel = similar.fuel !== item.fuel ? 10 : 0;
        similar.numDifference = differencePickup + differenceReturn + differnceKms + differenceFuel;
        return similar;
    });
    
    const sorted = _.sortBy(differences, 'numDifference');
    
    return sorted[0];
}

function compareData (currentArray, previousArray) {
    const changes = [];

    currentArray.forEach(currentItem => {
        if (_.find(previousArray,currentItem))
            return;

        const similar = findSimilar(currentItem, previousArray);
        if (!similar) {
            currentItem.type = 'NEW'
            return changes.push(currentItem);
        }

        const changeItem = _.clone(currentItem);
        changeItem.type = 'CHANGED';
        changeItem.differences = [];

        function findDifference(field) {
            if (similar[field] != currentItem[field])
            { 
                changeItem.differences.push({
                    field: field,
                    oldValue: similar[field],
                    newValue: currentItem[field]
                })
            }
        }

        _.keys(currentItem).forEach(key => {
            findDifference(key);
        })

        return changes.push(changeItem);
    })

    return changes;
};

function formatChange (change) {
    let message = `<span style="font-size: 1.1em"><b>${change.model}</b> - ${change.group}<br/></span>`;
    message += `Von <b>${change.pickupCity}</b> nach <b>${change.returnCity}</b><br/>`;

    message += `Ab ${app.formatDateHelper(change.pickupTimestamp)} bis ${app.formatDateHelper(change.returnTimestamp)}<br/>`
    message += `Inkl. ${change.distance} km`
    if (change.freeFuel)
        message += ` und einer Tankfüllung`
    message += `<br/>`
    if (change.type == 'NEW')
        message = `➕ ` + message
    if (change.type == 'CHANGED'){
        message = `✍️ ` + message;
        message += `Änderungen: `
        message += change.differences.map(difference => {
            const fieldNameMap = {
                pickupTimestamp: "Abholzeitpunkt",
                returnTimestamp: "Rückgabezeitpunkt",
                distance: "Inklusivkilometer",
                freeFuel: "Tankfüllung"
            };

            if (difference.field === 'freeFuel'){
                if (difference.newValue) {if (!difference.oldValue) return 'Tankfüllung hinzugefügt'}
                else if (difference.oldValue) {if (!difference.newValue) return 'Tankfüllung entfernt'}
                else return 'Tankfüllung geändert'
            }
            if (/.+Timestamp/.exec(difference.field) )
                return `${fieldNameMap[difference.field]} (${app.formatDateHelper(difference.oldValue)} → ${app.formatDateHelper(difference.newValue)})`
            
            console.log(difference);
            return `${fieldNameMap[difference.field]} (${difference.oldValue} → ${difference.newValue})`
        }).join(', ');
    }

    return message;
}

async function run() {
    if (typeof TARGET_MAIL === null) app.handleError('No target mail address set');
    if (typeof SENDER_MAIL === null) app.handleError('No sender mail address set');
    if (typeof SMTP_STRING === null) app.handleError('Missing SMTP connection url');

    await app.run();
}

run();