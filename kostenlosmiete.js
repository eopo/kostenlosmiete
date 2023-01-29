const fs = require('fs');
const nodemailer = require('nodemailer');
const cheerio = require('cheerio');
const axios = require('axios').default;
const _ = require('lodash');

const URL = 'https://www.starcar.de/specials/kostenlos-mieten/';
const TARGET_MAIL = process.env.TARGET_MAIL;
const SENDER_MAIL = process.env.SENDER_MAIL;
const SMTP_STRING = process.env.SMTP_STRING;

const transporter = nodemailer.createTransport(SMTP_STRING);

async function getStarcarData() {
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

function formatEmail (changes) {
    const messages = changes.map(e => formatChange(e))
    const content = messages.join('<br/><br/>') + `<br/><br/>Datenstand: ${formatDateHelper(new Date)}`
    const subject = `${changes.length} Starcar-Mieten geändert um ${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute: '2-digit'})}`
    return {content, subject}
}

function sendEmail (message) {
    
    const mailOptions = {
        from: SENDER_MAIL,
        to: TARGET_MAIL,
        subject: message.subject,
        html: message.content
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error(error);
        } else {
            console.log(`Email sent: ${info.response}`);
        }
    });
};

function compareData (currentArray, previousArray) {
    const changes = [];

    currentArray.forEach(currentItem => {
        if (_.find(previousArray,currentItem))
            return;

        const properties = ['pickupCity','returnCity','group','model']
        const matchset = _.pick(currentItem, properties)
        if (similar = _.find(previousArray, matchset)) {
            const changeItem = _.clone(currentItem);
            changeItem.type = 'CHANGED';
            changeItem.differences = [];

            function checkDifference (field) {
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
                checkDifference(key);
            })
            return changes.push(changeItem);
        }
        
        currentItem.type = 'NEW'
        changes.push(currentItem);
    })

    return changes;
};

function formatDateHelper (timestamp) {
    return new Date(timestamp).toLocaleString('de-DE', {weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})
}

function formatChange (change) {
    let message = `<span style="font-size: 1.1em"><b>${change.model}</b> - ${change.group}<br/></span>`;
    message += `Von <b>${change.pickupCity}</b> nach <b>${change.returnCity}</b><br/>`;

    message += `Ab ${formatDateHelper(change.pickupTimestamp)} bis ${formatDateHelper(change.returnTimestamp)}<br/>`
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
                console.log(difference);
                if (difference.newValue) {if (!difference.oldValue) return 'Tankfüllung hinzugefügt'}
                else if (difference.oldValue) {if (!difference.newValue) return 'Tankfüllung entfernt'}
                else return 'Tankfüllung geändert'
            }
            if (/.+Timestamp/.exec(difference.field) )
                return `${fieldNameMap[difference.field]} (${formatDateHelper(difference.oldValue)} → ${formatDateHelper(difference.newValue)})`
            
            console.log(difference);
            return `${fieldNameMap[difference.field]} (${difference.oldValue} → ${difference.newValue})`
        }).join(', ');
    }

    return message;
}

async function run () {
  let currentArray = await getStarcarData();
  let previousArray = [];
  try {
    previousArray = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
  } catch (error) {
    console.error(error);
  }
  const changes = compareData(currentArray, previousArray);
  if (changes.length > 0) {
    const email = formatEmail(changes);
    sendEmail(email);
  }
  fs.writeFileSync('data.json', JSON.stringify(currentArray, null, 2));
};

run();