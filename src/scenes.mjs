// Scenario presets: one click fills every input. objKB is the typical size of a static file (request fees).
// slug: the scenario's own page (/blog-hosting-cost/), which is also where shared links land.
export const SCENES = [
  { id: "blog", slug: "blog-hosting-cost", vcpu: 1, ram: 2, disk: 25, gb: 100, staticPct: 80, storeGB: 10, objKB: 100 },
  { id: "saas", slug: "saas-hosting-cost", vcpu: 2, ram: 4, disk: 50, gb: 2048, staticPct: 30, storeGB: 50, objKB: 200 },
  { id: "proxy", slug: "proxy-vps-cost", vcpu: 1, ram: 2, disk: 25, gb: 5120, staticPct: 0, storeGB: 0, objKB: 500 },
  { id: "download", slug: "download-site-cost", vcpu: 2, ram: 4, disk: 50, gb: 20480, staticPct: 95, storeGB: 2048, objKB: 50000 },
  { id: "media", slug: "video-hosting-cost", vcpu: 4, ram: 8, disk: 80, gb: 102400, staticPct: 90, storeGB: 10240, objKB: 2000 },
  { id: "backup", slug: "backup-storage-cost", vcpu: 0, ram: 0, disk: 0, gb: 500, staticPct: 100, storeGB: 5120, objKB: 10000 },
];
// machine size presets: [vcpu, ram, disk]
export const SIZES = [[1, 2, 25], [2, 4, 50], [4, 8, 80], [8, 16, 160]];
