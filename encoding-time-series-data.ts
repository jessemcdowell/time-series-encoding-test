import express from 'express';
import compression from 'compression';
import { AddressInfo } from 'node:net';
import axios, { AxiosRequestConfig } from "axios";

interface Point {
    time: Date,
    value: number
}

function generatePoints(pointCount: number, decimalPlaces: number): Point[] {
    const output: Point[] = new Array(pointCount);
    let time = new Date('2024-01-01');
    const millisecondsPerHour = 1000 * 60 * 60;
    const power = Math.pow(10, decimalPlaces);
    let randomValue = Math.random();
    for (let i = 0; i < pointCount; i++) {
        randomValue += Math.random() - 0.5;
        output[i] = {
            time,
            value: Math.round(randomValue * power) / power
        };
        time = new Date(time.getTime() + millisecondsPerHour);
    }
    return output;
}

function encodeBinaryPairs(points: Point[]): Buffer {
    const buffer = Buffer.allocUnsafe(points.length * 16);
    for (let i = 0; i < points.length; i++) {
        buffer.writeDoubleBE(points[i].time.getTime(), i * 16);
        buffer.writeDoubleBE(points[i].value, i * 16 + 8);
    }
    return buffer;
}

function encodeBinarySets(points: Point[]): Buffer {
    const buffer = Buffer.allocUnsafe(points.length * 16);
    const secondBlock = points.length * 8;
    for (let i = 0; i < points.length; i++) {
        buffer.writeDoubleBE(points[i].time.getTime(), i * 8);
        buffer.writeDoubleBE(points[i].value, i * 8 + secondBlock);
    }
    return buffer;
}

const app = express();
app.use(compression());

app.get('/:pointCount(\\d+)/:decimalPlaces(\\d+)', (request, response) => {
    const {pointCount, decimalPlaces} = request.params;
    response.send(generatePoints(parseInt(pointCount), parseInt(decimalPlaces)));
});

app.get(`/:pointCount(\\d+)/binary/:structure(pairs|sets)/:encoding(raw|base64)`, (request, response) => {
    const {pointCount, structure, encoding} = request.params;
    const pointData = generatePoints(parseInt(pointCount), 5);
    const data = structure === 'pairs' ? encodeBinaryPairs(pointData) : encodeBinarySets(pointData);
    response.type('text/plain');
    response.send(encoding === 'base64' ? data.toString('base64') : data);
});

async function runTests(baseUrl: string) {
    async function getResponseLength(path: string, options: Partial<AxiosRequestConfig> = {}): Promise<number> {
        let loaded = 0;
        await axios.get(`${baseUrl}${path}`, {
            onDownloadProgress: progressEvent => { loaded = progressEvent.loaded; },
            ...options
        });
        return loaded;
    }

    const disableCompression = {headers: {'Accept-Encoding': ''}};

    console.info('running tests...');

    console.info(`1m/5, json, no compression: ${await getResponseLength('/1000000/5', disableCompression)}`);
    console.info(`1m/5, json, gzip:           ${await getResponseLength('/1000000/5')}`);

    console.info(`1m/5, binary pairs, no compression: ${await getResponseLength('/1000000/binary/pairs/raw', disableCompression)}`);
    console.info(`1m/5, binary pairs, gzip:           ${await getResponseLength('/1000000/binary/pairs/raw')}`);
    console.info(`1m/5, binary sets, gzip:            ${await getResponseLength('/1000000/binary/sets/raw')}`);

    console.info(`1m/5, base64 pairs, no compression: ${await getResponseLength('/1000000/binary/pairs/base64', disableCompression)}`);
    console.info(`1m/5, base64 pairs, gzip:           ${await getResponseLength('/1000000/binary/pairs/base64')}`);
    console.info(`1m/5, base64 sets, gzip:            ${await getResponseLength('/1000000/binary/sets/base64')}`);
}

const server = app.listen(0, 'localhost', () => {
    const baseUrl = `http://localhost:${(<AddressInfo>server.address()).port}`;
    console.info(`Server is running on ${baseUrl}`);

    // comment out the following line to make the server available for your own testing
    runTests(baseUrl).then(() => server.close());
});
