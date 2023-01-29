FROM node:14

COPY package*.json /app/
RUN npm install
RUN apt-get update && apt-get install -y cron
RUN echo "0 */2 * * * node /app/kostenlosmiete.js" > /etc/cron.d/node-cron
RUN chmod 0644 /etc/cron.d/node-cron

COPY . /app
WORKDIR /app

CMD ["cron", "-f"]
