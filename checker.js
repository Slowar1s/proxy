import fs from 'fs/promises';
import got from 'got';
import colors from 'colors';
import iconv from 'iconv-lite';
import pMap from 'p-map';
import HttpsProxyAgent from 'https-proxy-agent';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

const defaultUrl = 'https://www.cloudflare.com/';
const defaultElement = 'Security';
const defaultTimeout = 5000; // milliseconds
const defaultConcurrency = 50;
const defaultProxyFile = 'hui.txt';
const defaultAliveProxyFile = 'alive.txt';

async function checkProxy(url, element, timeout, proxy, counts, aliveProxyFile) {
    const [address, port] = proxy.split(':');
    const ipAddress = address;
    const proxyUrl = `http://${address}:${port}`;

    const options = {
        headers: {
            'Content-Type': 'text/html',
            // 'Cache-Control': 'no-cache',
        },
        agent: {
            https: new HttpsProxyAgent(proxyUrl),
        },
    };

    let html = '';

    try {
        const res = await Promise.race([
            got(url, options),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
        ]);

        // Convert
        const buffer = Buffer.from(res.body);
        html = iconv.decode(buffer, 'utf8');

        const elementFound = html.includes(element);
        const statusCode = res.statusCode;

        if (elementFound) {
            counts.numAlive++;
            console.log(`[${colors.green(ipAddress)}] took ${res.timings.phases.total}ms to respond with status code: [${colors.green(statusCode)}]. [${colors.green('Alive')}] Element found: ${colors.green(`${element}`)} : ${counts.numAlive} alive, ${counts.numDied} died.`);
            console.log(`HTML body of ${ipAddress}: ${html.slice(0, 15)}...`);
            await fs.appendFile(aliveProxyFile, `${proxy}\n`);
            return {
                proxy,
                ipAddress,
                port,
                statusCode,
                html,
            };
        } else {
            counts.numDied++;
            console.log(`[${colors.green(ipAddress)}] timed out or took too long to respond with status code: [${colors.red(statusCode)}]. Element not found : ${counts.numAlive} alive, ${counts.numDied} died.`);
            console.log(`HTML body of ${ipAddress}: ${html.slice(0, 15)}...`);
            res.destroy(); // Close
            return {
                proxy,
                ipAddress,
                port,
                statusCode,
                html,
            };
        }
    } catch (err) {
        counts.numDied++;
        console.log(`[${colors.green(ipAddress)}] threw an error with status code: [${colors.red(err.statusCode)}], [${colors.red('Dead')}] : ${counts.numAlive} alive, ${counts.numDied} died.`);
        console.log(`HTML body of ${ipAddress}: ${err}`);
        return {
            proxy,
            ipAddress,
            port,
            statusCode: err.statusCode,
            html: err.message,
            isDuplicate: false,
        };
    }
}

async function main(url, element, timeout, concurrency, proxyFile, aliveProxyFile) {
    let counts = {
        numAlive: 0,
        numDied: 0,
        numTotal: 0,
    };

    let uniqueIps = new Map();
    let duplicates = [];

    const proxies = (await fs.readFile(proxyFile, 'utf-8')).split('\n').filter(Boolean);
    const results = await pMap(
        proxies,
        (proxy) => checkProxy(url, element, timeout, proxy, counts, aliveProxyFile),
        {concurrency}
    );

    for (const result of results) {
        counts.numTotal++;

        if (result.html.includes(element)) {
            if (!uniqueIps.has(`${result.ipAddress}:${result.port}`)) {
                counts.numAlive++;
                console.log(`[${colors.green(result.ipAddress)}] [${colors.green('Alive')}] Element found: ${colors.green(`${element}`)}.`);
                uniqueIps.set(`${result.ipAddress}:${result.port}`);
            } else {
                duplicates.push(result.proxy);
                console.log(`[${colors.green(result.ipAddress)}] is a duplicate. [${colors.yellow('Duplicate')}]`);
            }
        } else {
            counts.numDied++;
            console.log(`[${colors.green(result.ipAddress)}] timed out or took too long to respond with status code: [${colors.red(result.statusCode)}]. Element not found.`);
        }
    }


    console.log(`Finished checking all proxies. ${counts.numAlive} alive, ${counts.numDied} dead`);
    console.log(`Found ${duplicates.length} duplicate IP addresses.`);

    let uniqueProxies = Array.from(uniqueIps.entries()).map(([ipAddress, port]) => `${ipAddress}:${port}`);
    await fs.writeFile('unique.txt', uniqueProxies.join('\n'));

    if (duplicates.length > 0) {
        await fs.writeFile('duplicates.txt', duplicates.join('\n'));
        console.log(`Duplicate proxies saved to duplicates.txt.`);
    }
}

const argv = yargs(hideBin(process.argv))
    .option('url', {
        alias: 'u',
        default: defaultUrl,
        describe: 'The URL to check against',
        type: 'string',
    })
    .option('element', {
        alias: 'e',
        default: defaultElement,
        describe: 'The element to search for in the response HTML',
        type: 'string',
    })
    .option('timeout', {
        alias: 't',
        default: defaultTimeout,
        describe: 'Timeout for each request in milliseconds',
        type: 'number',
    })
    .option('concurrency', {
        alias: 'c',
        default: defaultConcurrency,
        describe: 'Number of concurrent requests to make',
        type: 'number',
    })
    .option('proxyFile', {
        alias: 'p',
        default: defaultProxyFile,
        describe: 'Path to the file containing proxy addresses',
        type: 'string',
    })
    .option('aliveProxyFile', {
        alias: 'a',
        default: defaultAliveProxyFile,
        describe: 'Path to the file to save alive proxy addresses',
        type: 'string',
    })
    .demandCommand(0, 0, 'No command specified')
    .help('h')
    .alias('h', 'help')
    .argv;

const { url, element, timeout, concurrency, proxyFile, aliveProxyFile } = argv;

main(url, element, timeout, concurrency, proxyFile, aliveProxyFile);
