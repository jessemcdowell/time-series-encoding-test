import express from 'express';
import compression from 'compression';
import msgpack from 'express-msgpack'
import { AddressInfo } from 'node:net';
import axios, { AxiosRequestConfig } from "axios";
import protobuf from "protobufjs";

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
app.use(compression({filter: (req, res) => req.headers['accept-encoding']?.indexOf('gzip') !== -1}));
app.use(msgpack());

app.get('/:pointCount(\\d+)/:decimalPlaces(\\d+)', (request, response) => {
    const {pointCount, decimalPlaces} = request.params;
    response.send(generatePoints(parseInt(pointCount), parseInt(decimalPlaces)));
});

app.get(`/binary/:structure(pairs|sets)/:encoding(raw|base64)/:pointCount(\\d+)`, (request, response) => {
    const {pointCount, structure, encoding} = request.params;
    const pointData = generatePoints(parseInt(pointCount), 5);
    const data = structure === 'pairs' ? encodeBinaryPairs(pointData) : encodeBinarySets(pointData);
    response.type('text/plain');
    response.send(encoding === 'base64' ? data.toString('base64') : data);
});

app.get('/csv/:pointCount(\\d+)/:decimalPlaces(\\d+)', (request, response) => {
    const {pointCount, decimalPlaces} = request.params;
    const points = generatePoints(parseInt(pointCount), parseInt(decimalPlaces));
    const data = 'time,value\n' + points.map(point => `${point.time.toISOString()},${point.value}`).join('\n');

    response.type('text/csv');
    response.send(data);
});


app.get('/:pointCount(\\d+)/:decimalPlaces(\\d+)/protobuf', async (request, response) => {
    const {pointCount, decimalPlaces} = request.params;
    const pointArrayData = {
        points: generatePoints(parseInt(pointCount), parseInt(decimalPlaces)).map(point => ({
            time: point.time.getTime(),
            value: point.value
        }))
    };

    const PointArrayMessage = (await protobuf.load('point-array.proto')).lookupType('timeseries.PointArray');
    response.type('application/octet-stream');
    response.send(PointArrayMessage.encode(pointArrayData).finish());
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
    const gzip = {headers: {'Accept-Encoding': 'gzip'}};
    const msgPack = {headers: {'Accept': 'application/msgpack'}};

    console.info('running tests...');

    console.info(`json, no compression: ${await getResponseLength('/1000000/5', disableCompression)}`);
    console.info(`json, gzip:           ${await getResponseLength('/1000000/5', gzip)}`);

    console.info(`csv, no compression: ${await getResponseLength('/csv/1000000/5', disableCompression)}`);
    console.info(`csv, gzip:           ${await getResponseLength('/csv/1000000/5', gzip)}`);

    console.info(`msgpack, no compression: ${await getResponseLength('/1000000/5', {headers: {...msgPack.headers, ...disableCompression.headers}})}`);
    console.info(`msgpack, gzip:           ${await getResponseLength('/1000000/5', {headers: {...msgPack.headers, ...gzip.headers}})}`);

    console.info(`protobuf, no compression: ${await getResponseLength('/1000000/5/protobuf', disableCompression)}`);
    console.info(`protobuf, gzip:           ${await getResponseLength('/1000000/5/protobuf', gzip)}`);

    console.info(`binary pairs, no compression: ${await getResponseLength('/binary/pairs/raw/1000000', disableCompression)}`);
    console.info(`binary pairs, gzip:           ${await getResponseLength('/binary/pairs/raw/1000000', gzip)}`);
    console.info(`binary sets, gzip:            ${await getResponseLength('/binary/sets/raw/1000000', gzip)}`);

    console.info(`base64 pairs, no compression: ${await getResponseLength('/binary/pairs/base64/1000000', disableCompression)}`);
    console.info(`base64 pairs, gzip:           ${await getResponseLength('/binary/pairs/base64/1000000', gzip)}`);
    console.info(`base64 sets, gzip:            ${await getResponseLength('/binary/sets/base64/1000000', gzip)}`);
}

const server = app.listen(0, 'localhost', () => {
    const baseUrl = `http://localhost:${(<AddressInfo>server.address()).port}`;
    console.info(`Server is running on ${baseUrl}`);

    // comment out the following line to make the server available for your own testing
    runTests(baseUrl).then(() => server.close());
});
