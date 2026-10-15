let products = [
  { id: 1, name: "Sculpted stoneware cup", brand: "Sunday Studio", category: "Home", price: 18500, rating: "4.9", badge: "MADE IN LAGOS", image: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=700&q=82" },
  { id: 2, name: "The everyday carry-all", brand: "Aso & Thread", category: "Style", price: 32000, rating: "4.8", badge: "SMALL BATCH", image: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=700&q=82" },
  { id: 3, name: "Calm skin facial oil", brand: "Nàkó Botanics", category: "Beauty", price: 14500, rating: "5.0", badge: "CUSTOMER FAVOURITE", image: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=700&q=82" },
  { id: 4, name: "Palm Sunday art print", brand: "Tolu Akin Studio", category: "Art", price: 24000, rating: "4.9", badge: "ORIGINAL ART", image: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=700&q=82" },
  { id: 5, name: "Owambe chilli crunch", brand: "Pepper & Palm", category: "Food", price: 8500, rating: "4.9", badge: "PANTRY HERO", image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=700&q=82" },
  { id: 6, name: "Loom cushion cover", brand: "Sunday Studio", category: "Home", price: 27500, rating: "4.7", badge: "HANDWOVEN", image: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=700&q=82" },
  { id: 7, name: "Daylight beaded hoops", brand: "Aso & Thread", category: "Style", price: 12000, rating: "4.8", badge: "HANDMADE", image: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=700&q=82" },
  { id: 8, name: "Sunday morning coffee", brand: "Kawa House", category: "Food", price: 11000, rating: "4.9", badge: "ROASTED IN LAGOS", image: "https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=700&q=82" },
];

const formatPrice = (amount) => `₦${amount.toLocaleString("en-NG")}`;
// Add a verified seller phone in international format; leave it blank until then.
const sellers = Object.fromEntries(products.map(({ brand }) => [brand, { whatsapp: "" }]));
const state = { category: "All", search: "", sort: "featured", seller: "", sellerId: "" };
let activeSellerId = null;
const grid = document.querySelector("#product-grid");
const resultCount = document.querySelector("#result-count");
const emptyState = document.querySelector("#empty-state");
const overlay = document.querySelector("#overlay");
const sellerModal = document.querySelector("#seller-modal");
const toast = document.querySelector("#toast");
let toastTimer;
let previouslyFocused;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealTargets = new Set();
let revealFrame;

function revealElements(elements) {
  elements.forEach((element, index) => {
    if (reducedMotion.matches) {
      element.classList.add("is-visible");
      return;
    }
    element.classList.add("reveal-on-scroll");
    element.style.setProperty("--reveal-delay", `${Math.min(index, 7) * 65}ms`);
    revealTargets.add(element);
  });
  updateScrollReveals();
}

function updateScrollReveals() {
  if (reducedMotion.matches) {
    revealTargets.forEach((element) => element.classList.add("is-visible"));
    revealTargets.clear();
    return;
  }
  revealTargets.forEach((element) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.top < window.innerHeight * 0.9 && bounds.bottom > 0) {
      element.classList.add("is-visible");
      revealTargets.delete(element);
    }
  });
}

function scheduleScrollReveals() {
  if (revealFrame) return;
  revealFrame = window.requestAnimationFrame(() => {
    revealFrame = undefined;
    updateScrollReveals();
  });
}

function filteredProducts() {
  const query = state.search.trim().toLowerCase();
  const filtered = products.filter((product) => {
    const matchesCategory = state.category === "All" || product.category === state.category;
    const matchesSearch = !query || `${product.name} ${product.brand} ${product.category}`.toLowerCase().includes(query);
    const matchesSeller = state.sellerId
      ? String(product.sellerId) === state.sellerId
      : !state.seller || product.brand === state.seller;
    return matchesCategory && matchesSearch && matchesSeller;
  });
  if (state.sort === "price-low") filtered.sort((a, b) => a.price - b.price);
  if (state.sort === "price-high") filtered.sort((a, b) => b.price - a.price);
  return filtered;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function isPublicBlobUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function renderProducts() {
  const visible = filteredProducts();
  resultCount.textContent = `${visible.length} ${visible.length === 1 ? "find" : "finds"}`;
  emptyState.hidden = visible.length > 0;
  grid.hidden = visible.length === 0;
  document.querySelector("#seller-filter").hidden = !state.seller;
  document.querySelector("#seller-filter-name").textContent = state.seller;
  grid.innerHTML = visible.map((product) => `
    <article class="product-card">
      <div class="product-image-wrap">
        <img class="product-image" src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy" />
        <span class="product-badge">${escapeHTML(product.badge)}</span>
      </div>
      <div class="product-info">
        <p class="product-brand">${escapeHTML(product.brand)}</p>
        <div class="product-name-row"><h3 class="product-name">${escapeHTML(product.name)}</h3><span class="product-price">${formatPrice(product.price)}</span></div>
        <div class="product-rating"><b>★</b> ${escapeHTML(product.rating)}</div>
        <div class="product-actions">
          <button class="contact-button" data-contact-product="${escapeHTML(product.id)}">Contact seller <span aria-hidden="true">↗</span></button>
          <button class="seller-products-button" data-see-seller="${escapeHTML(product.brand)}" data-see-seller-id="${escapeHTML(product.sellerId ?? "")}">See more from this seller</button>
        </div>
      </div>
    </article>`).join("");
  revealElements(grid.querySelectorAll(".product-card"));
}

async function loadMarketplaceProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Could not load seller products.");
    const result = await response.json();
    const categoryLabels = {
      "Clothing and Fashion": "Style",
      "Mobile devices and Gadgets": "Electronics",
      "Mobile phone accessories": "Electronics",
      Electronics: "Electronics",
      "Kitchen Appliances": "Home",
      "Home decor": "Home",
      "Cakes and pastries": "Food",
      "Skincare essentials": "Beauty",
      Toiletries: "Beauty",
      "Personal care": "Beauty",
      "Educational Materials": "Books",
    };
    const sellerProducts = result.products.flatMap((product) => {
      const image = Array.isArray(product.images)
        ? product.images.find(isPublicBlobUrl)
        : null;
      if (!image) return [];
      const brand = String(product.storeName);
      sellers[brand] = { whatsapp: String(product.phone || "") };
      return [{
        id: `seller-${product.id}`,
        sellerId: product.sellerId,
        name: product.name,
        brand,
        category: categoryLabels[product.category] || product.category,
        price: product.price,
        rating: "New",
        badge: "SELLER LISTING",
        image,
        phone: product.phone,
      }];
    });
    products = [...products.filter((product) => !String(product.id).startsWith("seller-")), ...sellerProducts];
    renderProducts();
  } catch (error) {
    console.error("Marketplace products could not be loaded.", error);
  }
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2100);
}
function openPanel(panel) {
  previouslyFocused = document.activeElement;
  overlay.hidden = false;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  panel.querySelector("button, input")?.focus();
}
function closePanels() {
  overlay.hidden = true;
  sellerModal.classList.remove("open");
  sellerModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  previouslyFocused?.focus();
}

document.querySelector("#search-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#search-input").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderProducts();
});
document.querySelector("#sort-select").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderProducts();
});
document.querySelectorAll(".category-chip").forEach((button) => {
  button.addEventListener("click", () => {
    state.category = button.dataset.category;
    state.seller = "";
    state.sellerId = "";
    document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
    renderProducts();
  });
});
document.querySelector("#clear-search").addEventListener("click", () => {
  state.category = "All";
  state.search = "";
  state.seller = "";
  state.sellerId = "";
  document.querySelector("#search-input").value = "";
  document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === "All"));
  renderProducts();
});
grid.addEventListener("click", (event) => {
  const contactButton = event.target.closest("[data-contact-product]");
  if (contactButton) {
    const product = products.find((item) => String(item.id) === contactButton.dataset.contactProduct);
    if (!product) return;
    const phone = String(product.phone || sellers[product.brand]?.whatsapp || "").replace(/\D/g, "");
    if (!phone) {
      showToast(`WhatsApp contact for ${product.brand} hasn’t been added yet.`);
      return;
    }
    const internationalPhone = phone.startsWith("0") ? `234${phone.slice(1)}` : phone;
    const message = `Hi ${product.brand}, I'm interested in ${product.name} on Gote.ng.`;
    window.open(`https://wa.me/${internationalPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    return;
  }
  const sellerButton = event.target.closest("[data-see-seller]");
  if (sellerButton) {
    state.seller = sellerButton.dataset.seeSeller;
    state.sellerId = sellerButton.dataset.seeSellerId || "";
    state.category = "All";
    document.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.category === "All"));
    renderProducts();
    document.querySelector("#seller-filter").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
document.querySelector("#clear-seller-filter").addEventListener("click", () => {
  state.seller = "";
  state.sellerId = "";
  renderProducts();
});

function setSellerView(view, seller) {
  document.querySelector("#seller-form").hidden = view !== "register";
  document.querySelector("#seller-login-form").hidden = view !== "login";
  document.querySelector("#seller-dashboard").hidden = view !== "dashboard";
  const description = document.querySelector("#seller-modal-description");
  description.textContent = view === "login"
    ? "Sign in to manage your products and store."
    : view === "dashboard"
      ? "Manage your listings and add products to your Gote.ng store."
      : "Tell us a little about your business to apply for a seller account.";
  document.querySelector("#seller-title").innerHTML = view === "login"
    ? "Welcome <em>back.</em>"
    : view === "dashboard" ? "Your store <em>dashboard.</em>" : "Your store starts <em>here.</em>";
  if (seller) {
    activeSellerId = seller.id;
    document.querySelector("#dashboard-store-name").textContent = seller.storeName;
    loadSellerProducts();
  }
}

async function loadSellerProducts() {
  const list = document.querySelector("#seller-products");
  const empty = document.querySelector("#seller-products-empty");
  list.replaceChildren();
  empty.hidden = false;
  empty.textContent = "Loading your products…";
  try {
    const response = await fetch("/api/seller/products");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not load your products.");
    list.innerHTML = result.products.map((product) => {
      const image = product.images.find(isPublicBlobUrl);
      if (!image) return "";
      return `
      <article class="seller-product-item">
        <img src="${escapeHTML(image)}" alt="" />
        <div><h4>${escapeHTML(product.name)} · ${formatPrice(product.price)}</h4>
          <p>${escapeHTML(product.description)}</p></div>
      </article>`;
    }).join("");
    empty.hidden = result.products.length > 0;
  } catch (error) {
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = error.message || "Could not load your products.";
  }
}

async function showSellerPanel() {
  setSellerView("register");
  openPanel(sellerModal);
  try {
    const response = await fetch("/api/session");
    if (response.ok) {
      const result = await response.json();
      setSellerView("dashboard", result.seller);
    }
  } catch (error) {
    console.error("Seller session could not be restored.", error);
  }
}

document.querySelectorAll("#open-seller, #open-seller-banner").forEach((button) => button.addEventListener("click", () => {
  showSellerPanel();
}));
document.querySelector("#open-promotion-application").addEventListener("click", () => {
  showSellerPanel();
});
document.querySelectorAll(".close-overlay").forEach((button) => button.addEventListener("click", closePanels));
overlay.addEventListener("click", closePanels);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !overlay.hidden) closePanels();
});
document.querySelector("#show-seller-login").addEventListener("click", () => setSellerView("login"));
document.querySelector("#show-seller-register").addEventListener("click", () => setSellerView("register"));

const productCategory = document.querySelector("#product-category");
const otherCategoryField = document.querySelector("#other-category-field");
const otherCategoryInput = document.querySelector("#other-category");

productCategory.addEventListener("change", () => {
  const isOther = productCategory.value === "Other";
  otherCategoryField.hidden = !isOther;
  otherCategoryInput.required = isOther;
  if (!isOther) otherCategoryInput.value = "";
});

document.querySelector("#seller-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#seller-error");
  const nin = form.elements.nin.value.trim();
  const submitButton = form.querySelector('[type="submit"]');
  error.textContent = "";
  if (!/^\d{11}$/.test(nin)) {
    error.textContent = "Enter a valid 11-digit NIN.";
    form.elements.nin.focus();
    return;
  }
  if (!form.reportValidity()) return;
  if (form.elements.password.value !== form.elements.passwordConfirm.value) {
    error.textContent = "Your passwords do not match.";
    form.elements.passwordConfirm.focus();
    return;
  }
  const application = Object.fromEntries(new FormData(form).entries());
  submitButton.disabled = true;
  submitButton.textContent = "Creating account…";
  try {
    const response = await fetch("/api/sellers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(application),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We couldn’t create your seller account. Please try again.");
    form.reset();
    otherCategoryField.hidden = true;
    otherCategoryInput.required = false;
    setSellerView("dashboard", result.seller);
  } catch (submissionError) {
    error.textContent = submissionError.message || "We couldn’t create your seller account. Please try again.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit seller application <span aria-hidden="true">↗</span>';
  }
});

document.querySelector("#seller-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#seller-login-error");
  const button = form.querySelector('[type="submit"]');
  if (!form.reportValidity()) return;
  error.textContent = "";
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We couldn’t sign you in. Please try again.");
    form.reset();
    setSellerView("dashboard", result.seller);
  } catch (loginError) {
    error.textContent = loginError.message || "We couldn’t sign you in. Please try again.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in to your store <span aria-hidden="true">↗</span>';
  }
});

document.querySelector("#seller-logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/session", { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not sign out.");
    activeSellerId = null;
    productForm.reset();
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    imagePreview.replaceChildren();
    document.querySelector("#seller-products").replaceChildren();
    setSellerView("register");
    showToast("You’ve signed out of your seller account.");
  } catch (error) {
    showToast(error.message || "Could not sign out. Please try again.");
  }
});

const productForm = document.querySelector("#product-form");
const productImageInput = document.querySelector("#product-images");
const imagePreview = document.querySelector("#image-preview");
let previewUrls = [];

productImageInput.addEventListener("change", () => {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  imagePreview.replaceChildren();
  const files = [...productImageInput.files];
  const error = document.querySelector("#product-error");
  error.textContent = "";
  if (files.length > 10) {
    error.textContent = "Choose no more than 10 images.";
    return;
  }
  const invalidFile = files.find((file) =>
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024
  );
  if (invalidFile) {
    error.textContent = invalidFile.size > 5 * 1024 * 1024
      ? "Each image must be 5 MB or smaller."
      : "Use JPEG, PNG or WebP images.";
    return;
  }
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Preview: ${file.name}`;
    imagePreview.append(image);
  });
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#product-error");
  const button = productForm.querySelector('[type="submit"]');
  const files = [...productImageInput.files];
  error.textContent = "";
  if (!productForm.reportValidity()) return;
  if (!files.length || files.length > 10) {
    error.textContent = "Choose between 1 and 10 images.";
    return;
  }
  if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
    error.textContent = "Use JPEG, PNG or WebP images no larger than 5 MB each.";
    return;
  }
  button.disabled = true;
  const uploadedImages = [];
  try {
    if (!activeSellerId) throw new Error("Sign in again before adding a product.");
    for (const [index, file] of files.entries()) {
      button.textContent = `Uploading image ${index + 1} of ${files.length}…`;
      const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
      const blob = await upload(
        `products/${activeSellerId}/${crypto.randomUUID()}.${extension}`,
        file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({ sellerId: String(activeSellerId) }),
        },
      );
      uploadedImages.push(blob.url);
    }
    button.textContent = "Saving product…";
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: productForm.elements.name.value,
        description: productForm.elements.description.value,
        price: productForm.elements.price.value,
        images: uploadedImages,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not add this product.");
    productForm.reset();
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    imagePreview.replaceChildren();
    await Promise.all([loadSellerProducts(), loadMarketplaceProducts()]);
    showToast("Your product is now listed on Gote.ng.");
  } catch (uploadError) {
    error.textContent = uploadError.message || "Could not add this product. Please try again.";
  } finally {
    button.disabled = false;
    button.innerHTML = 'Add product <span aria-hidden="true">↗</span>';
  }
});

const heroSlides = [...document.querySelectorAll(".hero-slide")];
const heroDots = [...document.querySelectorAll(".carousel-dot")];
const heroCarousel = document.querySelector("#hero-carousel");
const heroTitleFirst = document.querySelector("#hero-title-first");
const heroTitleEmphasis = document.querySelector("#hero-title-emphasis");
const heroHeadlines = [
  ["You need am?", "We get am!"],
  ["No added fees.", "You dey in charge!"],
  ["Contact sellers directly.", "No Middlemen."],
  ["Verified Sellers.", "No Scam Zone."],
  ["Sell with Ease.", "Buy with peace of mind!"],
];
let heroSlideIndex = 0;
let heroTimer;

function showHeroSlide(index) {
  heroSlideIndex = (index + heroSlides.length) % heroSlides.length;
  [heroTitleFirst.textContent, heroTitleEmphasis.textContent] = heroHeadlines[heroSlideIndex];
  heroSlides.forEach((slide, slideIndex) => {
    const isActive = slideIndex === heroSlideIndex;
    slide.classList.toggle("active", isActive);
    slide.setAttribute("aria-hidden", String(!isActive));
    heroDots[slideIndex].classList.toggle("active", isActive);
    if (isActive) heroDots[slideIndex].setAttribute("aria-current", "true");
    else heroDots[slideIndex].removeAttribute("aria-current");
  });
}

function startHeroRotation() {
  clearInterval(heroTimer);
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    heroTimer = setInterval(() => showHeroSlide(heroSlideIndex + 1), 6000);
  }
}

document.querySelector("#hero-previous").addEventListener("click", () => {
  showHeroSlide(heroSlideIndex - 1);
  startHeroRotation();
});
document.querySelector("#hero-next").addEventListener("click", () => {
  showHeroSlide(heroSlideIndex + 1);
  startHeroRotation();
});
heroDots.forEach((dot) => dot.addEventListener("click", () => {
  showHeroSlide(Number(dot.dataset.slide));
  startHeroRotation();
}));
heroCarousel.addEventListener("mouseenter", () => clearInterval(heroTimer));
heroCarousel.addEventListener("mouseleave", startHeroRotation);
heroCarousel.addEventListener("focusin", () => clearInterval(heroTimer));
heroCarousel.addEventListener("focusout", (event) => {
  if (!heroCarousel.contains(event.relatedTarget)) startHeroRotation();
});

renderProducts();
loadMarketplaceProducts();
showHeroSlide(0);
startHeroRotation();
revealElements(document.querySelectorAll(
  ".category-chip, .section-heading, .promotion-section, .seller-banner, .values-row article"
));
window.addEventListener("scroll", scheduleScrollReveals, { passive: true });
window.addEventListener("resize", scheduleScrollReveals);
if (!reducedMotion.matches) {
  document.querySelector(".hero-copy")?.classList.add("hero-enter");
  document.querySelector(".hero-art")?.classList.add("hero-enter");
}
import { upload } from "@vercel/blob/client";
