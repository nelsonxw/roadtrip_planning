import { expect, test, type Page } from "@playwright/test";

const password = "password123";
const uniqueEmail = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.test`;

async function signUp(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

/** Picks the first autocomplete result for a field. The app only accepts a picked result, never raw text. */
async function pickPlace(page: Page, label: string, query: string, expected: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(query);
  await page.getByRole("option", { name: new RegExp(expected) }).first().click();
}

async function createTrip(page: Page, name: string) {
  await pickPlace(page, "Start", "Austin", "Austin");
  await pickPlace(page, "Destination", "Denver", "Denver");
  await page.getByLabel("Trip name (optional)").fill(name);
  await page.getByLabel("Days").fill("3");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

const itinerary = (page: Page) => page.getByLabel("Day-by-day itinerary");

test("sign up, create a trip with autocomplete, and see the route and itinerary", async ({ page }) => {
  await signUp(page, uniqueEmail("create"));
  await createTrip(page, "E2E route trip");
  await expect(itinerary(page).getByRole("heading", { name: /Day 1/ })).toBeVisible();
  await expect(itinerary(page).getByText("Austin, TX, USA")).toBeVisible();
  await expect(itinerary(page).getByText("Denver, CO, USA")).toBeVisible();
  await expect(page.getByText("DEMO ROUTING")).toBeVisible();
});

test("add a stop by search, then remove it through a confirmed assistant proposal", async ({ page }) => {
  await signUp(page, uniqueEmail("chat"));
  await createTrip(page, "E2E assistant trip");

  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(itinerary(page).getByText("Santa Fe, NM, USA").first()).toBeVisible();

  await page.getByLabel("Message the trip assistant").fill("remove Santa Fe");
  await page.getByRole("button", { name: "Send" }).click();
  const proposal = page.getByRole("region", { name: /Proposal: Remove Santa Fe/ });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Accept" })).toBeDisabled();
  await proposal.getByRole("checkbox").check();
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(itinerary(page).getByText("Santa Fe, NM, USA")).toHaveCount(0);
  await expect(page.getByText("Applied: Remove Santa Fe, NM, USA.")).toBeVisible();
});

test("selecting an itinerary stop highlights its map marker", async ({ page }) => {
  await signUp(page, uniqueEmail("sync"));
  await createTrip(page, "E2E sync trip");
  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(itinerary(page).getByText("Santa Fe, NM, USA").first()).toBeVisible();

  const marker = page.getByRole("button", { name: /Required stop 1: Santa Fe/ });
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute("aria-pressed", "false");
  await itinerary(page).getByRole("button", { name: /^Santa Fe, NM, USA/ }).first().click();
  await expect(marker).toHaveAttribute("aria-pressed", "true");
});

test("import a CSV: invalid rows are skipped, valid rows keep file order", async ({ page }) => {
  await signUp(page, uniqueEmail("import"));
  await createTrip(page, "E2E import trip");

  await page.getByRole("button", { name: "Import a stop list (CSV or XLSX)" }).click();
  const csv = [
    "Name,Address,Latitude,Longitude,Required",
    "Santa Fe Plaza,,35.687,-105.9378,required",
    "Nowhere,,,,",
    "Denver Museum,Denver,,,optional",
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "stops.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("3 rows · 2 will be imported · 1 invalid")).toBeVisible();
  await expect(page.getByText("Provide an address or coordinates.")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 stops" }).click();
  await expect(page.getByRole("heading", { name: "Import a stop list" })).toHaveCount(0);

  const names = await itinerary(page).getByRole("button").allTextContents();
  const santaFe = names.findIndex((text) => text.includes("Santa Fe Plaza"));
  const denver = names.findIndex((text) => text.includes("Denver Museum"));
  expect(santaFe).toBeGreaterThanOrEqual(0);
  expect(denver).toBeGreaterThan(santaFe);
});

test("export links download the latest itinerary as CSV and PDF", async ({ page }) => {
  await signUp(page, uniqueEmail("export"));
  await createTrip(page, "E2E export trip");
  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(itinerary(page).getByText("Santa Fe, NM, USA").first()).toBeVisible();

  const csvHref = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const csvResponse = await page.request.get(new URL(csvHref ?? "", page.url()).toString());
  expect(csvResponse.headers()["content-disposition"]).toContain(".csv");
  expect(await csvResponse.text()).toContain("Santa Fe, NM, USA");

  const pdfHref = await page.getByRole("link", { name: "Export PDF" }).getAttribute("href");
  const pdfResponse = await page.request.get(new URL(pdfHref ?? "", page.url()).toString());
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("another user cannot open a trip by its URL", async ({ page, browser }) => {
  await signUp(page, uniqueEmail("owner"));
  await createTrip(page, "E2E private trip");
  const tripUrl = page.url();

  const intruderContext = await browser.newContext();
  const intruder = await intruderContext.newPage();
  await signUp(intruder, uniqueEmail("intruder"));
  await intruder.goto(tripUrl);
  await expect(intruder.getByText("This page could not be found.")).toBeVisible();
  await intruderContext.close();
});

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
