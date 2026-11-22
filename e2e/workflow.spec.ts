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
  await page.getByLabel("One way", { exact: true }).check();
  await page.getByLabel("Days").fill("3");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

const itinerary = (page: Page) => page.getByLabel("Day-by-day itinerary");

/**
 * Days start collapsed and only one is open at a time. Waits for the stop to appear in the trip,
 * then opens each collapsed day until the stop shows. Matches on the place name, because the
 * geocoder's full formatted name (for example "USA" or "United States of America") varies by provider.
 */
async function expandDayWith(page: Page, name: RegExp) {
  const stop = itinerary(page).getByText(name).first();
  await stop.waitFor({ state: "attached" });
  // The header's accessible name starts with the disclosure arrow, so match "Day N" anywhere in the name.
  const days = itinerary(page).getByRole("button", { name: /Day \d+/ });
  const count = await days.count();
  for (let i = 0; i < count; i++) {
    const day = days.nth(i);
    if ((await day.getAttribute("aria-expanded")) === "false") await day.click();
    if (await stop.isVisible()) return;
  }
}

test("sign up, create a trip with autocomplete, and see the route and itinerary", async ({ page }) => {
  await signUp(page, uniqueEmail("create"));
  await createTrip(page, "E2E route trip");
  await expect(itinerary(page).getByRole("heading", { name: /Day 1/ })).toBeVisible();
  await expandDayWith(page, /Austin/);
  await expect(itinerary(page).getByText(/Austin/).first()).toBeVisible();
  await expandDayWith(page, /Denver/);
  await expect(itinerary(page).getByText(/Denver/).first()).toBeVisible();
  // The header names the routing provider, whether it is live or demo data.
  await expect(page.getByText(/route provider:/)).toBeVisible();
});

test("add a stop by search, then remove it through a confirmed assistant proposal", async ({ page }) => {
  await signUp(page, uniqueEmail("chat"));
  await createTrip(page, "E2E assistant trip");

  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expandDayWith(page, /Santa Fe/);
  await expect(itinerary(page).getByText(/Santa Fe/).first()).toBeVisible();

  await page.getByLabel("Message the trip assistant").fill("remove Santa Fe");
  await page.getByRole("button", { name: "Send" }).click();
  const proposal = page.getByRole("region", { name: /Proposal: Remove Santa Fe/ });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Accept" })).toBeDisabled();
  await proposal.getByRole("checkbox").check();
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(itinerary(page).getByText(/Santa Fe/)).toHaveCount(0);
  await expect(page.getByText(/Applied: Remove Santa Fe/)).toBeVisible();
});

test("selecting an itinerary stop highlights its map marker", async ({ page }) => {
  await signUp(page, uniqueEmail("sync"));
  await createTrip(page, "E2E sync trip");
  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expandDayWith(page, /Santa Fe/);
  await expect(itinerary(page).getByText(/Santa Fe/).first()).toBeVisible();

  const marker = page.getByRole("button", { name: /Required stop 1: Santa Fe/ });
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute("aria-pressed", "false");
  await itinerary(page).getByRole("button", { name: /^Santa Fe/ }).first().click();
  await expect(marker).toHaveAttribute("aria-pressed", "true");
});

test("export links download the latest itinerary as CSV and PDF", async ({ page }) => {
  await signUp(page, uniqueEmail("export"));
  await createTrip(page, "E2E export trip");
  await pickPlace(page, "Search a place", "Santa Fe", "Santa Fe");
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expandDayWith(page, /Santa Fe/);
  await expect(itinerary(page).getByText(/Santa Fe/).first()).toBeVisible();

  const csvHref = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const csvResponse = await page.request.get(new URL(csvHref ?? "", page.url()).toString());
  expect(csvResponse.headers()["content-disposition"]).toContain(".csv");
  expect(await csvResponse.text()).toMatch(/Santa Fe/);

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

test.afterAll(async () => {
  const { purgeTestUsersBySuffix } = await import("../tests/cleanup");
  await purgeTestUsersBySuffix("@e2e.test");
});
