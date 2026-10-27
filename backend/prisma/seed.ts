/**
 * Development seed.
 *
 * Creates the minimum catalogue, service areas, pricing policy, plans, coupons and
 * demo accounts required to exercise the full booking flow locally:
 *
 *   customer books -> admin assigns -> partner accepts and completes -> financials recorded
 *
 * The script is idempotent: every write is an upsert keyed on a natural unique column,
 * so `npm run db:seed` can be re-run safely. It never runs against production data
 * because `NODE_ENV=production` is rejected outright.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The seed runs through ts-node, which does not read `.env` the way the Prisma CLI does.
// Load the nearest env file (backend/.env, then the monorepo root .env) before connecting.
for (const candidate of ['.env', '../.env']) {
  const envPath = resolve(process.cwd(), candidate);
  if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });
}

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Demo credentials (development only)                                 */
/* ------------------------------------------------------------------ */

const DEV_ACCOUNTS = {
  admin: { phone: '+919000000001', email: 'admin@Autowra.example', password: 'Admin@12345', name: 'Asha Admin' },
  partner: { phone: '+919000000002', email: 'partner@Autowra.example', password: 'Partner@12345', name: 'Ravi Partner' },
  customer: { phone: '+919000000003', email: 'customer@Autowra.example', password: 'Customer@12345', name: 'Neha Customer' },
} as const;

const SERVICE_AREA_SEEDS = [
  {
    name: 'Koramangala & Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCodes: ['560034', '560038', '560095', '560001'],
    boundary: [
      { latitude: 12.9, longitude: 77.59 },
      { latitude: 12.9, longitude: 77.66 },
      { latitude: 12.97, longitude: 77.66 },
      { latitude: 12.97, longitude: 77.59 },
    ],
  },
  {
    name: 'Hitech City & Gachibowli',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCodes: ['500081', '500032', '500019'],
    boundary: [
      { latitude: 17.4, longitude: 78.33 },
      { latitude: 17.4, longitude: 78.42 },
      { latitude: 17.49, longitude: 78.42 },
      { latitude: 17.49, longitude: 78.33 },
    ],
  },
  {
    name: 'Baner & Aundh',
    city: 'Pune',
    state: 'Maharashtra',
    postalCodes: ['411045', '411007', '411021'],
    boundary: [
      { latitude: 18.52, longitude: 73.75 },
      { latitude: 18.52, longitude: 73.83 },
      { latitude: 18.6, longitude: 73.83 },
      { latitude: 18.6, longitude: 73.75 },
    ],
  },
] as const;

const ADDON_SEEDS = [
  { slug: 'engine-bay-clean', name: 'Engine bay cleaning', description: 'Degrease and dress the engine bay.', priceMinor: 49900, durationMinutes: 20 },
  { slug: 'underbody-wash', name: 'Underbody wash', description: 'High-pressure underbody flush.', priceMinor: 39900, durationMinutes: 15 },
  { slug: 'tyre-dressing', name: 'Tyre dressing', description: 'Deep clean and gloss the tyres.', priceMinor: 29900, durationMinutes: 10 },
  { slug: 'interior-vacuum', name: 'Interior vacuum', description: 'Full cabin vacuum including boot.', priceMinor: 34900, durationMinutes: 20 },
  { slug: 'dashboard-polish', name: 'Dashboard polish', description: 'UV-protectant dressing for the dashboard.', priceMinor: 44900, durationMinutes: 15 },
  { slug: 'anti-bacterial-spray', name: 'Anti-bacterial fumigation', description: 'Cabin sanitisation spray.', priceMinor: 54900, durationMinutes: 20 },
  { slug: 'glass-water-repellent', name: 'Glass water repellent', description: 'Rain-repellent coating on all glass.', priceMinor: 59900, durationMinutes: 20 },
  { slug: 'chain-lubrication', name: 'Chain clean and lube', description: 'Degrease, clean and lubricate the drive chain.', priceMinor: 24900, durationMinutes: 15 },
  { slug: 'alloy-polish', name: 'Alloy and rim polish', description: 'Remove brake dust and polish the rims.', priceMinor: 32900, durationMinutes: 15 },
] as const;

interface ServiceSeed {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  vehicleType: 'CAR' | 'BIKE';
  categorySlug: string;
  eligibleVehicleSizes: string[];
  includedTasks: string[];
  basePriceMinor: number;
  durationMinutes: number;
  isPopular: boolean;
  sizePrices: Array<{ vehicleSize: string; priceMinor: number }>;
  addons: string[];
}

const CAR_SIZES = ['HATCHBACK', 'SEDAN', 'SUV', 'MUV', 'LUXURY'];
const BIKE_SIZES = ['BIKE_SMALL', 'BIKE_MEDIUM', 'BIKE_LARGE'];

const SERVICE_SEEDS: ServiceSeed[] = [
  {
    slug: 'car-basic-wash',
    name: 'Express exterior wash',
    shortDescription: 'A fast, careful exterior wash at your doorstep.',
    description:
      'Snow-foam pre-wash, two-bucket hand wash, alloy cleaning and a microfiber dry-down. Ideal between deep cleans.',
    vehicleType: 'CAR',
    categorySlug: 'car-wash',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Snow foam pre-wash', 'Two-bucket hand wash', 'Alloy and tyre cleaning', 'Microfiber dry-down'],
    basePriceMinor: 49900,
    durationMinutes: 45,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 49900 },
      { vehicleSize: 'SEDAN', priceMinor: 59900 },
      { vehicleSize: 'SUV', priceMinor: 69900 },
      { vehicleSize: 'MUV', priceMinor: 74900 },
      { vehicleSize: 'LUXURY', priceMinor: 89900 },
    ],
    addons: ['underbody-wash', 'tyre-dressing', 'glass-water-repellent'],
  },
  {
    slug: 'car-premium-wash',
    name: 'Premium exterior wash and wax',
    shortDescription: 'Exterior wash finished with a hand-applied wax layer.',
    description:
      'Everything in the express wash plus clay-bar decontamination and a carnauba wax coat for lasting gloss.',
    vehicleType: 'CAR',
    categorySlug: 'car-wash',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Everything in the express wash', 'Clay bar decontamination', 'Carnauba wax coat', 'Tyre dressing'],
    basePriceMinor: 89900,
    durationMinutes: 75,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 89900 },
      { vehicleSize: 'SEDAN', priceMinor: 104900 },
      { vehicleSize: 'SUV', priceMinor: 124900 },
      { vehicleSize: 'MUV', priceMinor: 134900 },
      { vehicleSize: 'LUXURY', priceMinor: 159900 },
    ],
    addons: ['engine-bay-clean', 'underbody-wash', 'glass-water-repellent', 'alloy-polish'],
  },
  {
    slug: 'car-deep-clean-interior',
    name: 'Interior deep clean',
    shortDescription: 'Shampoo, extract and protect the whole cabin.',
    description:
      'Seats and carpets shampooed and extracted, roof lining treated, plastics dressed and a full cabin fumigation.',
    vehicleType: 'CAR',
    categorySlug: 'car-interior',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Fabric shampoo and extraction', 'Roof lining treatment', 'Plastic and vinyl dressing', 'Cabin fumigation'],
    basePriceMinor: 149900,
    durationMinutes: 120,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 149900 },
      { vehicleSize: 'SEDAN', priceMinor: 169900 },
      { vehicleSize: 'SUV', priceMinor: 199900 },
      { vehicleSize: 'MUV', priceMinor: 209900 },
      { vehicleSize: 'LUXURY', priceMinor: 249900 },
    ],
    addons: ['dashboard-polish', 'anti-bacterial-spray', 'interior-vacuum'],
  },
  {
    slug: 'car-interior-detailing',
    name: 'Full interior detailing',
    shortDescription: 'Showroom-grade interior restoration, panel by panel.',
    description:
      'Steam cleaning, leather conditioning where present, vent detailing, and a protective coating on every interior surface.',
    vehicleType: 'CAR',
    categorySlug: 'car-interior',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Steam cleaning', 'Leather clean and condition', 'Vent and crevice detailing', 'Interior surface protection'],
    basePriceMinor: 299900,
    durationMinutes: 210,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 299900 },
      { vehicleSize: 'SEDAN', priceMinor: 329900 },
      { vehicleSize: 'SUV', priceMinor: 379900 },
      { vehicleSize: 'MUV', priceMinor: 389900 },
      { vehicleSize: 'LUXURY', priceMinor: 449900 },
    ],
    addons: ['dashboard-polish', 'anti-bacterial-spray', 'glass-water-repellent'],
  },
  {
    slug: 'car-rubbing-polishing',
    name: 'Rubbing and polishing',
    shortDescription: 'Machine polish to remove swirls and light scratches.',
    description:
      'Three-stage machine compounding and polishing to correct paint defects, finished with a sealant.',
    vehicleType: 'CAR',
    categorySlug: 'car-polish',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Paint decontamination', 'Machine compounding', 'Machine polishing', 'Sealant application'],
    basePriceMinor: 349900,
    durationMinutes: 240,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 349900 },
      { vehicleSize: 'SEDAN', priceMinor: 399900 },
      { vehicleSize: 'SUV', priceMinor: 469900 },
      { vehicleSize: 'MUV', priceMinor: 489900 },
      { vehicleSize: 'LUXURY', priceMinor: 569900 },
    ],
    addons: ['alloy-polish', 'glass-water-repellent', 'engine-bay-clean'],
  },
  {
    slug: 'car-ceramic-coating',
    name: 'Ceramic coating',
    shortDescription: 'Multi-year gloss and hydrophobic protection.',
    description:
      'Full paint correction followed by a professional-grade 9H ceramic coating, cured under controlled conditions.',
    vehicleType: 'CAR',
    categorySlug: 'car-protection',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Full paint correction', 'Panel wipe and degrease', '9H ceramic coating', 'Hydrophobic top coat'],
    basePriceMinor: 1899900,
    durationMinutes: 480,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 1899900 },
      { vehicleSize: 'SEDAN', priceMinor: 2199900 },
      { vehicleSize: 'SUV', priceMinor: 2699900 },
      { vehicleSize: 'MUV', priceMinor: 2799900 },
      { vehicleSize: 'LUXURY', priceMinor: 3299900 },
    ],
    addons: ['alloy-polish', 'glass-water-repellent'],
  },
  {
    slug: 'car-graphene-coating',
    name: 'Graphene coating',
    shortDescription: 'Maximum durability coating with extreme water beading.',
    description:
      'Graphene-infused coating over a corrected surface. Highest heat resistance and slickness in the Autowra range.',
    vehicleType: 'CAR',
    categorySlug: 'car-protection',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Full paint correction', 'Graphene coating application', 'Infrared curing', 'Aftercare kit'],
    basePriceMinor: 2799900,
    durationMinutes: 600,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 2799900 },
      { vehicleSize: 'SEDAN', priceMinor: 3199900 },
      { vehicleSize: 'SUV', priceMinor: 3899900 },
      { vehicleSize: 'MUV', priceMinor: 3999900 },
      { vehicleSize: 'LUXURY', priceMinor: 4599900 },
    ],
    addons: ['alloy-polish', 'glass-water-repellent'],
  },
  {
    slug: 'car-teflon-coating',
    name: 'Teflon paint sealant',
    shortDescription: 'Budget-friendly paint sealant with six months of gloss.',
    description: 'A polymer sealant that adds gloss and makes washing easier for around six months.',
    vehicleType: 'CAR',
    categorySlug: 'car-protection',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Surface decontamination', 'Teflon sealant application', 'Buff to gloss'],
    basePriceMinor: 189900,
    durationMinutes: 150,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 189900 },
      { vehicleSize: 'SEDAN', priceMinor: 219900 },
      { vehicleSize: 'SUV', priceMinor: 259900 },
      { vehicleSize: 'MUV', priceMinor: 269900 },
      { vehicleSize: 'LUXURY', priceMinor: 319900 },
    ],
    addons: ['alloy-polish', 'glass-water-repellent'],
  },
  {
    slug: 'car-engine-bay-detailing',
    name: 'Engine bay detailing',
    shortDescription: 'Safe degrease, rinse and dress of the engine bay.',
    description: 'Electronics are masked, the bay is degreased and rinsed, then dressed for a factory-fresh finish.',
    vehicleType: 'CAR',
    categorySlug: 'car-details',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['Electronics masking', 'Degrease and rinse', 'Hand detail', 'Dressing'],
    basePriceMinor: 129900,
    durationMinutes: 90,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 129900 },
      { vehicleSize: 'SEDAN', priceMinor: 139900 },
      { vehicleSize: 'SUV', priceMinor: 159900 },
      { vehicleSize: 'MUV', priceMinor: 159900 },
      { vehicleSize: 'LUXURY', priceMinor: 189900 },
    ],
    addons: ['underbody-wash', 'anti-bacterial-spray'],
  },
  {
    slug: 'car-ac-disinfection',
    name: 'AC vent disinfection',
    shortDescription: 'Clear odours and bacteria from the air-conditioning system.',
    description: 'Foam treatment through the vents followed by a cabin fumigation with a fresh scent.',
    vehicleType: 'CAR',
    categorySlug: 'car-details',
    eligibleVehicleSizes: CAR_SIZES,
    includedTasks: ['AC vent foam treatment', 'Cabin fumigation', 'Cabin filter clean'],
    basePriceMinor: 99900,
    durationMinutes: 60,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'HATCHBACK', priceMinor: 99900 },
      { vehicleSize: 'SEDAN', priceMinor: 109900 },
      { vehicleSize: 'SUV', priceMinor: 129900 },
      { vehicleSize: 'MUV', priceMinor: 129900 },
      { vehicleSize: 'LUXURY', priceMinor: 149900 },
    ],
    addons: ['anti-bacterial-spray', 'interior-vacuum'],
  },
  {
    slug: 'bike-basic-wash',
    name: 'Bike express wash',
    shortDescription: 'A quick, careful bike wash at your doorstep.',
    description: 'Snow foam, hand wash of painted panels, rim cleaning and a microfiber dry-down.',
    vehicleType: 'BIKE',
    categorySlug: 'bike-wash',
    eligibleVehicleSizes: BIKE_SIZES,
    includedTasks: ['Snow foam pre-wash', 'Hand wash', 'Rim and spoke cleaning', 'Microfiber dry-down'],
    basePriceMinor: 19900,
    durationMinutes: 30,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'BIKE_SMALL', priceMinor: 19900 },
      { vehicleSize: 'BIKE_MEDIUM', priceMinor: 24900 },
      { vehicleSize: 'BIKE_LARGE', priceMinor: 34900 },
    ],
    addons: ['chain-lubrication', 'tyre-dressing'],
  },
  {
    slug: 'bike-premium-wash',
    name: 'Bike premium wash and polish',
    shortDescription: 'Wash plus machine polish for a deep gloss finish.',
    description: 'Full wash, paint decontamination, machine polish on painted panels and a protective sealant.',
    vehicleType: 'BIKE',
    categorySlug: 'bike-wash',
    eligibleVehicleSizes: BIKE_SIZES,
    includedTasks: ['Full wash', 'Paint decontamination', 'Machine polish', 'Sealant application'],
    basePriceMinor: 49900,
    durationMinutes: 75,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'BIKE_SMALL', priceMinor: 49900 },
      { vehicleSize: 'BIKE_MEDIUM', priceMinor: 59900 },
      { vehicleSize: 'BIKE_LARGE', priceMinor: 74900 },
    ],
    addons: ['chain-lubrication', 'alloy-polish', 'tyre-dressing'],
  },
  {
    slug: 'bike-detailing',
    name: 'Bike full detailing',
    shortDescription: 'Strip-down level cleaning and protection.',
    description:
      'Removable panels cleaned off the bike, engine and exhaust detailing, chrome polishing and ceramic spray protection.',
    vehicleType: 'BIKE',
    categorySlug: 'bike-detailing',
    eligibleVehicleSizes: BIKE_SIZES,
    includedTasks: ['Panel-off cleaning', 'Engine and exhaust detailing', 'Chrome and alloy polishing', 'Ceramic spray protection'],
    basePriceMinor: 129900,
    durationMinutes: 180,
    isPopular: true,
    sizePrices: [
      { vehicleSize: 'BIKE_SMALL', priceMinor: 129900 },
      { vehicleSize: 'BIKE_MEDIUM', priceMinor: 149900 },
      { vehicleSize: 'BIKE_LARGE', priceMinor: 179900 },
    ],
    addons: ['chain-lubrication', 'alloy-polish', 'engine-bay-clean'],
  },
  {
    slug: 'bike-ceramic-coating',
    name: 'Bike ceramic coating',
    shortDescription: 'Long-lasting gloss and hydrophobic protection for your bike.',
    description: 'Paint correction on all panels followed by a ceramic coating that makes cleaning effortless.',
    vehicleType: 'BIKE',
    categorySlug: 'bike-detailing',
    eligibleVehicleSizes: BIKE_SIZES,
    includedTasks: ['Paint correction', 'Panel wipe', 'Ceramic coating', 'Hydrophobic top coat'],
    basePriceMinor: 399900,
    durationMinutes: 300,
    isPopular: false,
    sizePrices: [
      { vehicleSize: 'BIKE_SMALL', priceMinor: 399900 },
      { vehicleSize: 'BIKE_MEDIUM', priceMinor: 449900 },
      { vehicleSize: 'BIKE_LARGE', priceMinor: 519900 },
    ],
    addons: ['alloy-polish', 'chain-lubrication'],
  },
];

const CATEGORY_SEEDS = [
  { slug: 'car-wash', name: 'Car wash', description: 'Doorstep exterior and exterior-plus washes.', vehicleType: 'CAR' as const, iconKey: 'wash', sortOrder: 1 },
  { slug: 'car-interior', name: 'Interior cleaning', description: 'Interior deep cleans and full detailing.', vehicleType: 'CAR' as const, iconKey: 'interior', sortOrder: 2 },
  { slug: 'car-polish', name: 'Rubbing and polishing', description: 'Paint correction to remove swirls and scratches.', vehicleType: 'CAR' as const, iconKey: 'polish', sortOrder: 3 },
  { slug: 'car-protection', name: 'Paint protection', description: 'Ceramic, graphene and sealant packages.', vehicleType: 'CAR' as const, iconKey: 'shield', sortOrder: 4 },
  { slug: 'car-details', name: 'Add-on detailing', description: 'Engine bay, AC and glass detailing.', vehicleType: 'CAR' as const, iconKey: 'detailing', sortOrder: 5 },
  { slug: 'bike-wash', name: 'Bike wash', description: 'Doorstep bike washes and polish.', vehicleType: 'BIKE' as const, iconKey: 'bike-wash', sortOrder: 1 },
  { slug: 'bike-detailing', name: 'Bike detailing', description: 'Full detailing and ceramic protection for bikes.', vehicleType: 'BIKE' as const, iconKey: 'bike-detail', sortOrder: 2 },
];

const PLAN_SEEDS = [
  {
    slug: 'car-shine-monthly',
    name: 'Car Shine Monthly',
    description: 'Two doorstep exterior washes every month with priority slots.',
    priceMinor: 79900,
    validityDays: 30,
    visitAllowance: 2,
    vehicleType: 'CAR' as const,
    eligibleServiceSlugs: ['car-basic-wash', 'car-premium-wash'],
    benefits: ['Two exterior washes', 'Priority slot booking', 'Free tyre dressing on every visit'],
    sortOrder: 1,
  },
  {
    slug: 'car-care-quarterly',
    name: 'Car Care Quarterly',
    description: 'Five washes plus an interior deep clean every quarter.',
    priceMinor: 349900,
    validityDays: 90,
    visitAllowance: 5,
    vehicleType: 'CAR' as const,
    eligibleServiceSlugs: ['car-basic-wash', 'car-premium-wash', 'car-deep-clean-interior'],
    benefits: ['Five visits', 'One interior deep clean', 'Zero cancellation fees', 'Priority partner allocation'],
    sortOrder: 2,
  },
  {
    slug: 'bike-shine-monthly',
    name: 'Bike Shine Monthly',
    description: 'Three bike washes a month, including chain lubrication.',
    priceMinor: 49900,
    validityDays: 30,
    visitAllowance: 3,
    vehicleType: 'BIKE' as const,
    eligibleServiceSlugs: ['bike-basic-wash', 'bike-premium-wash'],
    benefits: ['Three washes', 'Free chain lubrication', 'Priority slot booking'],
    sortOrder: 1,
  },
];

const COUPON_SEEDS = [
  {
    code: 'WELCOME150',
    title: '₹150 off your first wash',
    description: 'New customers save ₹150 on any booking above ₹499.',
    type: 'FLAT' as const,
    value: 150,
    maxDiscountMinor: null,
    minOrderMinor: 49900,
    firstBookingOnly: true,
    usageLimitTotal: null,
    usageLimitPerCustomer: 1,
    appliesToVehicleType: null,
  },
  {
    code: 'SHINE20',
    title: '20% off up to ₹300',
    description: 'Save 20% on premium washes and detailing, up to ₹300.',
    type: 'PERCENTAGE' as const,
    value: 20,
    maxDiscountMinor: 30000,
    minOrderMinor: 89900,
    firstBookingOnly: false,
    usageLimitTotal: 1000,
    usageLimitPerCustomer: 3,
    appliesToVehicleType: null,
  },
  {
    code: 'BIKECARE100',
    title: '₹100 off bike services',
    description: 'Flat ₹100 off on any bike wash or detailing above ₹199.',
    type: 'FLAT' as const,
    value: 100,
    maxDiscountMinor: null,
    minOrderMinor: 19900,
    firstBookingOnly: false,
    usageLimitTotal: null,
    usageLimitPerCustomer: 5,
    appliesToVehicleType: 'BIKE' as const,
  },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Mirrors AvailabilityService.generateSlots so seeded data matches what the API generates. */
async function seedSlots(
  areaId: string,
  options: { days?: number; startHour?: number; endHour?: number; capacity?: number } = {},
): Promise<number> {
  const days = options.days ?? 21;
  const startHour = options.startHour ?? 8;
  const endHour = options.endHour ?? 20;
  const capacity = options.capacity ?? 4;
  const slotMinutes = 60;

  let created = 0;
  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const dayStart = startOfDay(addDays(new Date(), dayOffset));
    for (let minutes = startHour * 60; minutes + slotMinutes <= endHour * 60; minutes += slotMinutes) {
      const startTime = new Date(dayStart.getTime() + minutes * 60_000);
      const endTime = new Date(startTime.getTime() + slotMinutes * 60_000);
      const result = await prisma.availabilitySlot.upsert({
        where: { serviceAreaId_startTime: { serviceAreaId: areaId, startTime } },
        create: { serviceAreaId: areaId, startTime, endTime, capacity },
        update: { capacity, isActive: true },
      });
      if (result) created += 1;
    }
  }
  return created;
}

async function upsertUser(input: {
  phone: string;
  email: string;
  name: string;
  role: 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  password: string;
  adminRole?: 'SUPER_ADMIN' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT';
}): Promise<string> {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.upsert({
    where: { phone: input.phone },
    create: {
      phone: input.phone,
      email: input.email,
      name: input.name,
      role: input.role,
      adminRole: input.adminRole ?? null,
      passwordHash,
      isActive: true,
    },
    update: {
      email: input.email,
      name: input.name,
      role: input.role,
      adminRole: input.adminRole ?? null,
      passwordHash,
      isActive: true,
      deletedAt: null,
    },
  });
  return user.id;
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database. Set NODE_ENV=development to continue.');
  }

  console.log('Seeding Autowra development data...');

  /* 1. Business settings ------------------------------------------- */
  const settings: Prisma.InputJsonValue = {
    currency: 'INR',
    taxPercent: 18,
    platformCommissionPercent: 20,
    platformFeeMinor: 0,
    visitFeeMinor: 0,
    cancellationWindowHours: 4,
    cancellationFeePercent: 0,
    rescheduleWindowHours: 2,
    maxReschedulesPerBooking: 2,
    assignmentOfferTtlSeconds: 120,
    maxConcurrentPartnerJobs: 2,
    supportPhone: '+91 1800 000 000',
    supportEmail: 'support@Autowra.example',
  };
  await prisma.businessSetting.upsert({
    where: { key: 'business' },
    create: { key: 'business', value: settings },
    update: { value: settings },
  });
  console.log('  business settings ready');

  /* 2. Accounts ---------------------------------------------------- */
  const adminId = await upsertUser({
    ...DEV_ACCOUNTS.admin,
    role: 'ADMIN',
    adminRole: 'SUPER_ADMIN',
  });
  const partnerUserId = await upsertUser({ ...DEV_ACCOUNTS.partner, role: 'PARTNER' });
  const customerId = await upsertUser({ ...DEV_ACCOUNTS.customer, role: 'CUSTOMER' });
  console.log('  accounts ready');

  /* 3. Service areas ---------------------------------------------- */
  const areas: Array<{ id: string; name: string; latitude: number; longitude: number }> = [];
  for (const seed of SERVICE_AREA_SEEDS) {
    const existing = await prisma.serviceArea.findFirst({ where: { name: seed.name, city: seed.city } });
    const area = existing
      ? await prisma.serviceArea.update({
          where: { id: existing.id },
          data: {
            postalCodes: [...seed.postalCodes],
            boundary: seed.boundary as unknown as Prisma.InputJsonValue,
            status: 'ACTIVE',
          },
        })
      : await prisma.serviceArea.create({
          data: {
            name: seed.name,
            city: seed.city,
            state: seed.state,
            postalCodes: [...seed.postalCodes],
            boundary: seed.boundary as unknown as Prisma.InputJsonValue,
            status: 'ACTIVE',
          },
        });
    areas.push({
      id: area.id,
      name: area.name,
      latitude: seed.boundary[0]!.latitude + 0.035,
      longitude: seed.boundary[0]!.longitude + 0.035,
    });
  }
  console.log(`  ${areas.length} service areas ready`);

  /* 4. Availability slots ----------------------------------------- */
  let slotCount = 0;
  for (const area of areas) {
    slotCount += await seedSlots(area.id);
  }
  console.log(`  ${slotCount} availability slots ready`);

  /* 5. Categories, add-ons and services --------------------------- */
  const categoryIds = new Map<string, string>();
  for (const seed of CATEGORY_SEEDS) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        vehicleType: seed.vehicleType,
        iconKey: seed.iconKey,
        sortOrder: seed.sortOrder,
        isActive: true,
      },
      update: {
        name: seed.name,
        description: seed.description,
        vehicleType: seed.vehicleType,
        iconKey: seed.iconKey,
        sortOrder: seed.sortOrder,
        isActive: true,
      },
    });
    categoryIds.set(seed.slug, category.id);
  }

  const addonIds = new Map<string, string>();
  for (const seed of ADDON_SEEDS) {
    const addon = await prisma.serviceAddon.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        priceMinor: seed.priceMinor,
        durationMinutes: seed.durationMinutes,
        isActive: true,
      },
      update: {
        name: seed.name,
        description: seed.description,
        priceMinor: seed.priceMinor,
        durationMinutes: seed.durationMinutes,
        isActive: true,
      },
    });
    addonIds.set(seed.slug, addon.id);
  }

  for (const seed of SERVICE_SEEDS) {
    const categoryId = categoryIds.get(seed.categorySlug);
    if (!categoryId) throw new Error(`Missing category ${seed.categorySlug} for service ${seed.slug}`);

    const service = await prisma.service.upsert({
      where: { slug: seed.slug },
      create: {
        categoryId,
        slug: seed.slug,
        name: seed.name,
        shortDescription: seed.shortDescription,
        description: seed.description,
        vehicleType: seed.vehicleType,
        eligibleVehicleSizes: seed.eligibleVehicleSizes as never,
        includedTasks: seed.includedTasks,
        basePriceMinor: seed.basePriceMinor,
        durationMinutes: seed.durationMinutes,
        taxPercent: 18,
        isPopular: seed.isPopular,
        isActive: true,
      },
      update: {
        categoryId,
        name: seed.name,
        shortDescription: seed.shortDescription,
        description: seed.description,
        vehicleType: seed.vehicleType,
        eligibleVehicleSizes: seed.eligibleVehicleSizes as never,
        includedTasks: seed.includedTasks,
        basePriceMinor: seed.basePriceMinor,
        durationMinutes: seed.durationMinutes,
        taxPercent: 18,
        isPopular: seed.isPopular,
        isActive: true,
      },
    });

    for (const price of seed.sizePrices) {
      await prisma.serviceSizePrice.upsert({
        where: { serviceId_vehicleSize: { serviceId: service.id, vehicleSize: price.vehicleSize as never } },
        create: { serviceId: service.id, vehicleSize: price.vehicleSize as never, priceMinor: price.priceMinor },
        update: { priceMinor: price.priceMinor },
      });
    }

    await prisma.serviceAddonLink.deleteMany({ where: { serviceId: service.id } });
    for (const addonSlug of seed.addons) {
      const addonId = addonIds.get(addonSlug);
      if (!addonId) throw new Error(`Missing add-on ${addonSlug} for service ${seed.slug}`);
      await prisma.serviceAddonLink.create({ data: { serviceId: service.id, addonId } });
    }
  }
  console.log(`  ${SERVICE_SEEDS.length} services with size pricing and add-ons ready`);

  /* 6. Commission ------------------------------------------------ */
  const existingRule = await prisma.commissionRule.findFirst({ where: { scope: 'GLOBAL', partnerId: null } });
  if (existingRule) {
    await prisma.commissionRule.update({
      where: { id: existingRule.id },
      data: { name: 'Default platform commission', percent: 20, flatMinor: 0, priority: 0, isActive: true },
    });
  } else {
    await prisma.commissionRule.create({
      data: {
        name: 'Default platform commission',
        scope: 'GLOBAL',
        percent: 20,
        flatMinor: 0,
        priority: 0,
        isActive: true,
      },
    });
  }
  console.log('  commission rule ready');

  /* 7. Subscription plans ---------------------------------------- */
  for (const seed of PLAN_SEEDS) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        priceMinor: seed.priceMinor,
        currency: 'INR',
        validityDays: seed.validityDays,
        visitAllowance: seed.visitAllowance,
        vehicleType: seed.vehicleType,
        eligibleServiceSlugs: seed.eligibleServiceSlugs,
        benefits: seed.benefits,
        isActive: true,
        sortOrder: seed.sortOrder,
      },
      update: {
        name: seed.name,
        description: seed.description,
        priceMinor: seed.priceMinor,
        validityDays: seed.validityDays,
        visitAllowance: seed.visitAllowance,
        vehicleType: seed.vehicleType,
        eligibleServiceSlugs: seed.eligibleServiceSlugs,
        benefits: seed.benefits,
        isActive: true,
        sortOrder: seed.sortOrder,
      },
    });
  }
  console.log(`  ${PLAN_SEEDS.length} subscription plans ready`);

  /* 8. Coupons --------------------------------------------------- */
  const now = new Date();
  for (const seed of COUPON_SEEDS) {
    await prisma.coupon.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        title: seed.title,
        description: seed.description,
        type: seed.type,
        value: seed.value,
        maxDiscountMinor: seed.maxDiscountMinor,
        minOrderMinor: seed.minOrderMinor,
        firstBookingOnly: seed.firstBookingOnly,
        appliesToVehicleType: seed.appliesToVehicleType,
        isActive: true,
        startsAt: addDays(now, -1),
        endsAt: addDays(now, 180),
        usageLimitTotal: seed.usageLimitTotal,
        usageLimitPerCustomer: seed.usageLimitPerCustomer,
      },
      update: {
        title: seed.title,
        description: seed.description,
        type: seed.type,
        value: seed.value,
        maxDiscountMinor: seed.maxDiscountMinor,
        minOrderMinor: seed.minOrderMinor,
        firstBookingOnly: seed.firstBookingOnly,
        appliesToVehicleType: seed.appliesToVehicleType,
        isActive: true,
        endsAt: addDays(now, 180),
        usageLimitTotal: seed.usageLimitTotal,
        usageLimitPerCustomer: seed.usageLimitPerCustomer,
      },
    });
  }
  console.log(`  ${COUPON_SEEDS.length} coupons ready`);

  /* 9. Partner profile ------------------------------------------- */
  const partner = await prisma.partnerProfile.upsert({
    where: { userId: partnerUserId },
    create: {
      userId: partnerUserId,
      fullName: DEV_ACCOUNTS.partner.name,
      email: DEV_ACCOUNTS.partner.email,
      status: 'APPROVED',
      isOnline: true,
      skills: ['EXTERIOR_WASH', 'INTERIOR_CLEANING', 'POLISHING'],
      experienceYears: 6,
      vehicleLabel: 'Autowra van KA-01-AG-0001',
      upiId: 'ravi.partner@okhdfcbank',
      bankIfsc: 'HDFC0001234',
      bankAccountMasked: '••••4321',
      trainingChecklist: [
        { key: 'waterless-wash', label: 'Waterless wash technique', done: true },
        { key: 'paint-safety', label: 'Paint safety and swirl prevention', done: true },
        { key: 'customer-etiquette', label: 'Customer etiquette', done: true },
        { key: 'safety-kit', label: 'Safety and PPE kit', done: false },
      ] as unknown as Prisma.InputJsonValue,
      approvedAt: now,
      approvedByUserId: adminId,
      submittedAt: now,
      lastLatitude: areas[0]!.latitude,
      lastLongitude: areas[0]!.longitude,
      lastLocationAt: now,
    },
    update: {
      fullName: DEV_ACCOUNTS.partner.name,
      email: DEV_ACCOUNTS.partner.email,
      status: 'APPROVED',
      isOnline: true,
      approvedAt: now,
      approvedByUserId: adminId,
    },
  });

  await prisma.partnerServiceArea.deleteMany({ where: { partnerId: partner.id } });
  for (const area of areas) {
    await prisma.partnerServiceArea.create({ data: { partnerId: partner.id, serviceAreaId: area.id } });
  }

  const documentSeeds = [
    { type: 'AADHAAR' as const, fileName: 'aadhaar.pdf' },
    { type: 'PAN' as const, fileName: 'pan.pdf' },
    { type: 'DRIVING_LICENSE' as const, fileName: 'driving-licence.pdf' },
    { type: 'BANK_PROOF' as const, fileName: 'bank-proof.pdf' },
  ];
  for (const document of documentSeeds) {
    const existing = await prisma.partnerDocument.findFirst({
      where: { partnerId: partner.id, type: document.type },
    });
    const data = {
      partnerId: partner.id,
      type: document.type,
      status: 'APPROVED' as const,
      fileName: document.fileName,
      storageKey: `partner-documents/${partner.id}/${document.fileName}`,
      contentType: 'application/pdf',
      sizeBytes: 120_000,
      reviewedByUserId: adminId,
      reviewedAt: now,
    };
    if (existing) {
      await prisma.partnerDocument.update({ where: { id: existing.id }, data });
    } else {
      await prisma.partnerDocument.create({ data });
    }
  }
  console.log('  approved demo partner with service areas and documents ready');

  /* 10. Customer profile, vehicle and address --------------------- */
  await prisma.customerProfile.upsert({
    where: { userId: customerId },
    create: { userId: customerId, pushOptIn: true, emailOptIn: true, smsOptIn: true },
    update: {},
  });

  const primaryArea = areas[0]!;
  const addressSeed = {
    label: 'HOME' as const,
    nickname: 'Home',
    line1: '402, Sunrise Residency, 5th Block',
    line2: 'Koramangala',
    landmark: 'Near Forum Mall',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    latitude: primaryArea.latitude,
    longitude: primaryArea.longitude,
  };

  let address = await prisma.address.findFirst({ where: { customerId, line1: addressSeed.line1 } });
  if (address) {
    address = await prisma.address.update({
      where: { id: address.id },
      data: { ...addressSeed, serviceAreaId: primaryArea.id },
    });
  } else {
    address = await prisma.address.create({
      data: { customerId, ...addressSeed, country: 'India', isDefault: true, serviceAreaId: primaryArea.id },
    });
  }

  const vehicleSeed = {
    type: 'CAR' as const,
    size: 'SUV' as const,
    make: 'Hyundai',
    model: 'Creta',
    registrationNumber: 'KA01AG0001',
    nickname: 'Family SUV',
    color: 'Polar White',
  };

  const existingVehicle = await prisma.vehicle.findFirst({
    where: { customerId, registrationNumber: vehicleSeed.registrationNumber },
  });
  if (existingVehicle) {
    await prisma.vehicle.update({ where: { id: existingVehicle.id }, data: { ...vehicleSeed, isDefault: true } });
  } else {
    await prisma.vehicle.create({ data: { customerId, ...vehicleSeed, isDefault: true } });
  }

  const existingBike = await prisma.vehicle.findFirst({ where: { customerId, registrationNumber: 'KA01AG0002' } });
  if (!existingBike) {
    await prisma.vehicle.create({
      data: {
        customerId,
        type: 'BIKE',
        size: 'BIKE_MEDIUM',
        make: 'Royal Enfield',
        model: 'Classic 350',
        registrationNumber: 'KA01AG0002',
        nickname: 'Weekend ride',
        color: 'Stealth Black',
        isDefault: false,
      },
    });
  }

  await prisma.customerProfile.update({
    where: { userId: customerId },
    data: { defaultAddressId: address.id },
  });
  console.log('  demo customer with vehicle and address ready');

  /* Done --------------------------------------------------------- */
  console.log('\nSeed complete. Development sign-in details:\n');
  console.log(`  Admin    : ${DEV_ACCOUNTS.admin.email} / ${DEV_ACCOUNTS.admin.password}`);
  console.log(`  Partner  : ${DEV_ACCOUNTS.partner.phone} (OTP login)`);
  console.log(`  Customer : ${DEV_ACCOUNTS.customer.phone} (OTP login)`);
  console.log('\n  Development OTP for every phone number is DEV_AUTH_OTP (default 123456).\n');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
