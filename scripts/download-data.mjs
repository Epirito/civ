import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

const dataDir = path.resolve("public/data");
const force = process.argv.includes("--force");

const urls = {
  countries:
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
  criticalMinerals:
    "https://energy.usgs.gov/arcgis/rest/services/Hosted/Global_distribution_of_selected_critical_minerals/FeatureServer/2/query?where=1%3D1&outFields=dep_name,mineral,dep_type,location,latitude,longitude&outSR=4326&f=geojson&resultRecordCount=2000",
  majorDepositsKml: "https://mrdata.usgs.gov/major-deposits/ofr20051294.kml",
  miningPangaeaText:
    "https://doi.pangaea.de/10.1594/PANGAEA.942325?format=textfile",
  worldPopDensityImage:
    "https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_1km/ImageServer/exportImage?bbox=-180,-60,180,85&bboxSR=4326&imageSR=4326&size=1800,725&format=png&f=image",
  worldPopTotalImage:
    "https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Total_Population_1km/ImageServer/exportImage?bbox=-180,-60,180,85&bboxSR=4326&imageSR=4326&size=1800,725&format=png&f=image",
  mapSpamDataCenter: "https://www.mapspam.info/data/",
  mapSpamDataset:
    "https://dataverse.harvard.edu/api/datasets/:persistentId?persistentId=doi:10.7910/DVN/SWPENT",
  mapSpamHarvestedAreaGeoTiff:
    "https://dataverse.harvard.edu/api/access/datafile/13827040",
};

async function fetchOk(url, as = "json", options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "gis-world-data-downloader/0.1",
      accept: as === "json" ? "application/json,*/*" : "*/*",
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }

  if (as === "json") return res.json();
  if (as === "arrayBuffer") return Buffer.from(await res.arrayBuffer());
  return res.text();
}

async function fetchDataverseGuestbookFile(fileId) {
  const body = {
    guestbookResponse: {
      name: "GIS World",
      email: "gis.world@example.com",
      institution: "Independent",
      position: "Research",
      answers: [],
    },
  };
  const signed = await fetchOk(`https://dataverse.harvard.edu/api/access/datafile/${fileId}?signed=true`, "json", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!signed.data?.signedUrl) {
    throw new Error(`Dataverse did not return a signed URL for file ${fileId}`);
  }

  return fetchOk(signed.data.signedUrl, "arrayBuffer");
}

function textBetween(value, start, end) {
  const from = value.indexOf(start);
  if (from === -1) return "";
  const to = value.indexOf(end, from + start.length);
  if (to === -1) return "";
  return value.slice(from + start.length, to).trim();
}

function parseKmlPoints(kml) {
  const placemarks = [...kml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g)];
  const features = [];

  for (const [placemark] of placemarks) {
    const coords = textBetween(placemark, "<coordinates>", "</coordinates>")
      .split(/\s+/)
      .map((part) => part.split(",").map(Number))
      .find(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

    if (!coords) continue;

    const name = textBetween(placemark, "<name>", "</name>")
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "");
    const description = textBetween(placemark, "<description>", "</description>")
      .replace(/<!\[CDATA\[/g, "")
      .replace(/\]\]>/g, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [coords[0], coords[1]] },
      properties: { name, description },
    });
  }

  return { type: "FeatureCollection", features };
}

function extractMapSpamLatest(html) {
  const section = html.match(/SPAM 2020 v2\.2 Global data[\s\S]*?Citation[\s\S]*?<\/blockquote>/i)?.[0] ?? "";
  const links = [...section.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  return {
    title: "SPAM 2020 v2.2 Global data",
    updated: "2026-05-05",
    page: urls.mapSpamDataCenter,
    links,
    note:
      "The global MapSPAM assets are large CSV/GeoTIFF bundles hosted by the provider. This manifest records the current release links for targeted downloads.",
  };
}

function mapSpamFallback() {
  return {
    title: "SPAM 2020 Version 2.0 Release 2",
    updated: "2026-05-05",
    page: urls.mapSpamDataCenter,
    doi: "https://doi.org/10.7910/DVN/SWPENT",
    files: [
      {
        label: "spam2020V2r2_global_harvested_area.geotiff.zip",
        kind: "GeoTIFF ZIP",
        url: urls.mapSpamHarvestedAreaGeoTiff,
      },
    ],
    note:
      "MapSPAM blocked the scripted website metadata request. Release and file metadata are from the Harvard Dataverse API.",
  };
}

async function writeJson(file, value) {
  await writeFile(path.join(dataDir, file), `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(file) {
  try {
    await access(path.join(dataDir, file));
    return true;
  } catch {
    return false;
  }
}

async function runStep(file, label, task) {
  if (!force && (await exists(file))) {
    console.log(`Skipping ${label}; ${file} already exists.`);
    return;
  }

  console.log(label);
  await task();
}

function selectMapSpamTiffs(entries) {
  const tiffs = Object.keys(entries).filter((name) => /\.tiff?$/i.test(name));
  const allSystemTiffs = tiffs.filter((name) => /_a\.tiff?$/i.test(name));
  const source = allSystemTiffs.length ? allSystemTiffs : tiffs;
  const crops = [
    { key: "maize", pattern: /maiz/i, label: "Maize harvested area" },
    { key: "rice", pattern: /rice/i, label: "Rice harvested area" },
    { key: "wheat", pattern: /whea/i, label: "Wheat harvested area" },
  ];

  const selected = [];
  for (const crop of crops) {
    const match = source.find((name) => crop.pattern.test(name));
    if (match) selected.push({ ...crop, sourcePath: match });
  }

  if (selected.length > 0) return selected;

  return source.slice(0, 3).map((sourcePath, index) => ({
    key: `crop-${index + 1}`,
    label: path.basename(sourcePath).replace(/\.tiff?$/i, ""),
    sourcePath,
  }));
}

async function extractMapSpamRenderTiffs() {
  const zipPath = path.join(dataDir, "spam2020V2r2_global_harvested_area.geotiff.zip");
  const zip = new Uint8Array(await readFile(zipPath));
  const entries = unzipSync(zip);
  const selected = selectMapSpamTiffs(entries);

  if (selected.length === 0) {
    throw new Error("No GeoTIFF files found in MapSPAM harvested-area ZIP");
  }

  const files = [];
  for (const item of selected) {
    const output = `mapspam-harvested-${item.key}.tif`;
    await writeFile(path.join(dataDir, output), entries[item.sourcePath]);
    files.push({
      label: item.label,
      crop: item.key,
      sourcePath: item.sourcePath,
      url: `/data/${output}`,
    });
  }

  await writeJson("mapspam-harvested-render.json", {
    source: "spam2020V2r2_global_harvested_area.geotiff.zip",
    note: "These GeoTIFFs are extracted unchanged from the provider ZIP for browser rendering.",
    files,
  });
}

async function main() {
  await mkdir(dataDir, { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        key: "worldpop",
        label: "WorldPop population count, density, and degree of urbanisation",
        urls: [
          urls.worldPopDensityImage,
          urls.worldPopTotalImage,
          "https://hub.worldpop.org/geodata/listing?id=146",
        ],
      },
      {
        key: "mapspam",
        label: "MapSPAM agriculture",
        urls: [
          urls.mapSpamDataCenter,
          urls.mapSpamDataset,
          urls.mapSpamHarvestedAreaGeoTiff,
        ],
      },
      {
        key: "natural-earth",
        label: "Natural Earth Admin 0 countries",
        urls: [urls.countries],
      },
      {
        key: "critical-minerals",
        label: "USGS critical minerals",
        urls: [urls.criticalMinerals],
      },
      {
        key: "mining",
        label: "PANGAEA global-scale mining polygons v2 metadata",
        urls: [urls.miningPangaeaText],
      },
      {
        key: "major-deposits",
        label: "USGS major mineral deposits",
        urls: [urls.majorDepositsKml],
      },
    ],
  };

  await runStep("countries.geojson", "Downloading Natural Earth countries...", async () => {
    await writeJson("countries.geojson", await fetchOk(urls.countries));
  });

  await runStep("critical-minerals.geojson", "Downloading USGS critical minerals points...", async () => {
    await writeJson("critical-minerals.geojson", await fetchOk(urls.criticalMinerals));
  });

  await runStep("major-deposits.geojson", "Downloading and parsing USGS major deposits KML...", async () => {
    await writeJson("major-deposits.geojson", parseKmlPoints(await fetchOk(urls.majorDepositsKml, "text")));
  });

  await runStep("mining-pangaea.tsv", "Downloading PANGAEA mining dataset table...", async () => {
    await writeFile(
      path.join(dataDir, "mining-pangaea.tsv"),
      await fetchOk(urls.miningPangaeaText, "text"),
    );
  });

  await runStep("worldpop-density.png", "Downloading WorldPop density raster preview...", async () => {
    await writeFile(
      path.join(dataDir, "worldpop-density.png"),
      await fetchOk(urls.worldPopDensityImage, "arrayBuffer"),
    );
  });

  await runStep("worldpop-total.png", "Downloading WorldPop total population raster preview...", async () => {
    await writeFile(
      path.join(dataDir, "worldpop-total.png"),
      await fetchOk(urls.worldPopTotalImage, "arrayBuffer"),
    );
  });

  await runStep("spam2020V2r2_global_harvested_area.geotiff.zip", "Downloading MapSPAM harvested-area GeoTIFF ZIP...", async () => {
    await writeFile(
      path.join(dataDir, "spam2020V2r2_global_harvested_area.geotiff.zip"),
      await fetchDataverseGuestbookFile(13827040),
    );
  });

  await runStep("mapspam-harvested-render.json", "Extracting unchanged MapSPAM GeoTIFF render targets...", async () => {
    await extractMapSpamRenderTiffs();
  });

  await runStep("mapspam-release.json", "Recording current MapSPAM release metadata...", async () => {
    try {
      const metadata = await fetchOk(urls.mapSpamDataset);
      const files = metadata.data.latestVersion.files.map((file) => ({
        label: file.label,
        id: file.dataFile.id,
        size: file.dataFile.filesize,
        type: file.dataFile.friendlyType,
        description: file.description ?? file.dataFile.description ?? "",
      }));
      await writeJson("mapspam-release.json", {
        title: metadata.data.latestVersion.metadataBlocks.citation.fields.find((field) => field.typeName === "title")?.value,
        updated: metadata.data.latestVersion.distributionDate,
        doi: metadata.data.persistentUrl,
        files,
      });
    } catch (metadataError) {
      console.warn(`MapSPAM Dataverse metadata fetch failed: ${metadataError.message}`);
      try {
        await writeJson("mapspam-release.json", extractMapSpamLatest(await fetchOk(urls.mapSpamDataCenter, "text")));
      } catch (error) {
        console.warn(`MapSPAM website metadata fetch failed: ${error.message}`);
        await writeJson("mapspam-release.json", mapSpamFallback());
      }
    }
  });

  await runStep("manifest.json", "Writing source manifest...", async () => {
    await writeJson("manifest.json", manifest);
  });
  console.log("Done. Browser-ready data is in public/data.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
