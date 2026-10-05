(function() {
    "use strict";

    // --- CORE UTILS ---
    const Utils = {
        $: (s) => document.querySelector(s),
        $$: (s) => document.querySelectorAll(s),
        formatMoney: (n) => 'E' + parseFloat(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        placeholderImg: () => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#0b0b14"/><text x="50%" y="52%" font-family="Arial" font-size="42" fill="#00f3ff" text-anchor="middle">TOWERTECH</text></svg>'),
        uuid: () => Date.now().toString(36) + Math.random().toString(36).substr(2),
        escape: (str) => {
            if (typeof str !== 'string') return str;
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
        // Attribute context: escape() does NOT escape quotes, so never use it
        // inside src="...", onclick="..." or similar.
        escapeAttr: (str) => {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        // Single-quoted JS string inside an HTML attribute: backslash-escape the
        // string terminator and line breaks, neutralize angle brackets.
        escapeJs: (str) => {
            return String(str)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/</g, '\\x3c')
                .replace(/>/g, '\\x3e');
        },
        validateEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        validatePhone: (phone) => /^\+?[0-9\s-]{8,}$/.test(phone),
        debounce: (func, wait) => {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }
    };

    // --- API LAYER (REST BACKEND) ---
    // Facade that mirrors the old IndexedDB `Database` interface (get/getAll/put/delete/count/clearAll)
    // but maps every call to the TowerTech backend REST API. The rest of the app code is unchanged.
    class Database {
        constructor() {
            this.apiBase = '/api';
        }

        async init() {
            // Backend is seeded server-side; nothing to bootstrap locally.
            try { await this.getSettings(); } catch (e) { /* offline */ }
        }

        async _fetch(path, options = {}) {
            const res = await fetch(this.apiBase + path, {
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options
            });
            if (!res.ok) {
                let err = new Error('Request failed (' + res.status + ')');
                try {
                    const data = await res.json();
                    err = new Error(data.error || 'Request failed');
                    err.status = res.status;
                    err.code = data.code;
                    err.fields = data.fields;
                } catch (e) { /* non-json */ }
                throw err;
            }
            if (res.status === 204) return null;
            return res.json();
        }

        async getSettings() {
            const data = await this._fetch('/settings/public');
            this._publicSettings = data.settings || {};
            return this._publicSettings;
        }

        // ---- products ----
        async getAllProducts() {
            const data = await this._fetch('/products?limit=1000');
            return data.products || [];
        }

        async getProduct(id) {
            const data = await this._fetch('/products/' + id);
            return data.product || null;
        }

        async getReviews(pid) {
            const data = await this._fetch('/products/' + pid + '/reviews');
            return data.reviews || [];
        }

        // ---- interface parity with old Database (used by legacy code paths) ----
        get(store, key) {
            if (store === 'products') return this.getProduct(key);
            if (store === 'reviews') return this.getReviews(Array.isArray(key) ? key[0] : key);
            if (store === 'settings') return this.getSetting(key);
            if (store === 'users') return this._getUser(key);
            if (store === 'coupons') return this._getCoupon(key);
            return Promise.resolve(null);
        }

        async getAll(store) {
            if (store === 'products') return this.getAllProducts();
            if (store === 'reviews') return this.getAllReviews();
            if (store === 'settings') return this.getAllSettings();
            if (store === 'users') return this.getAllUsers();
            if (store === 'coupons') return this.getAllCoupons();
            if (store === 'orders') return this.getAllOrders();
            if (store === 'notifications') return this.getAllNotifications();
            if (store === 'logs') return this.getAllLogs();
            return [];
        }

        put(store, item) {
            if (store === 'products') return this.saveProduct(item);
            if (store === 'settings') return this.saveSetting(item);
            if (store === 'coupons') return this.saveCoupon(item);
            return Promise.resolve(item);
        }

        delete(store, key) {
            if (store === 'products') return this.deleteProduct(key);
            if (store === 'coupons') return this.deleteCoupon(key);
            return Promise.resolve(true);
        }

        count() { return this.getAllProducts().then(p => p.length); }

        async clearAll() {
            // Local client state only â€” the backend DB is not wiped via the UI.
            localStorage.clear();
            sessionStorage.clear();
            return true;
        }

        // ---- admin helpers ----
        async getAllOrders() {
            const isAdmin = app.auth.currentUser && app.auth.currentUser.role === 'admin';
            const data = await this._fetch(isAdmin ? '/orders/all' : '/orders');
            return (data.orders || []).map(o => ({
                id: o.id,
                userId: o.userId || 'guest',
                isGuest: o.isGuest,
                date: new Date(o.createdAt).toLocaleDateString(),
                timestamp: new Date(o.createdAt).getTime(),
                items: o.items || [],
                totals: { sub: o.subtotal, tax: o.tax, discount: o.discount, total: o.total },
                total: o.total,
                status: o.status,
                paymentMethod: o.paymentMethod
            }));
        }

        async getAllUsers() {
            const data = await this._fetch('/users');
            return (data.users || []).map(u => ({ email: u.email, name: u.name, role: u.role, status: u.status }));
        }

        async getAllCoupons() {
            const data = await this._fetch('/coupons');
            return data.coupons || [];
        }

        async getAllReviews() {
            const prods = await this.getAllProducts();
            const out = [];
            for (const p of prods) {
                try { out.push(...await this.getReviews(p.id)); } catch (e) { /* skip */ }
            }
            return out;
        }

        async getAllNotifications() {
            try {
                const data = await this._fetch('/users/me');
                return (data.notifications || []).map(n => ({
                    id: String(n.id),
                    userId: n.userId,
                    title: n.type,
                    msg: n.message,
                    read: n.read,
                    date: new Date(n.createdAt).getTime()
                }));
            } catch (e) { return []; }
        }

        async getAllLogs() {
            try {
                const data = await this._fetch('/settings/logs');
                return (data.logs || []).map(l => ({ ts: new Date(l.createdAt).getTime(), msg: l.message }));
            } catch (e) { return []; }
        }

        async getSetting(key) {
            const settings = await this.getAllSettings();
            const found = settings.find(s => s.id === key);
            return found || null;
        }

        async getAllSettings() {
            // Public settings first — this works for every visitor. The admin
            // endpoint is best-effort: a 403 for non-admins must not wipe out
            // the public values (that used to freeze the homepage hero on defaults).
            let pubSettings = {};
            try {
                const pub = await this._fetch('/settings/public');
                pubSettings = pub.settings || {};
            } catch (e) { /* offline — fall through with empty public set */ }
            let raw = [];
            try {
                const data = await this._fetch('/settings');
                raw = (data.settings || []).map(s => ({ id: s.key, value: s.value }));
            } catch (e) { /* non-admin (403) or offline — public values still apply */ }
            const pubMap = Object.entries(pubSettings).map(([key, value]) => ({ id: key, value }));
            // Overlay public (unmasked) values so whitelisted keys work for every user.
            for (const p of pubMap) {
                const idx = raw.findIndex(r => r.id === p.id);
                if (idx >= 0) raw[idx] = p; else raw.push(p);
            }
            const out = raw.map(s => {
                let value = s.value;
                if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('"'))) {
                    try { value = JSON.parse(value); } catch (e) { /* keep string */ }
                }
                return { id: s.id, value };
            });
            this._publicSettings = pubSettings;
            return out;
        }

        async _getUser(email) {
            try {
                const users = await this.getAllUsers();
                return users.find(u => u.email === email) || null;
            } catch (e) { return null; }
        }

        async _getCoupon(code) {
            try {
                const data = await this._fetch('/coupons/validate', { method: 'POST', body: JSON.stringify({ code }) });
                const c = data.coupon;
                return { code: c.code, discount: Number(c.discount), desc: c.desc, active: c.active };
            } catch (e) { return null; }
        }

        // ---- product mutations (admin) ----
        async saveProduct(p) {
            let existing = null;
            if (p.id) { try { existing = await this.getProduct(p.id); } catch (e) { /* new */ } }
            if (existing) {
                const data = await this._fetch('/products/' + p.id, { method: 'PUT', body: JSON.stringify(p) });
                return data.product;
            }
            const { id, ...create } = p;
            const data = await this._fetch('/products', { method: 'POST', body: JSON.stringify(create) });
            return data.product;
        }

        async deleteProduct(id) {
            return this._fetch('/products/' + id, { method: 'DELETE' });
        }

        async deleteCoupon(code) {
            return this._fetch('/coupons/' + encodeURIComponent(code), { method: 'DELETE' });
        }

        async saveCoupon(c) {
            const data = await this._fetch('/coupons', { method: 'POST', body: JSON.stringify(c) });
            return data.coupon;
        }

        async saveSetting(item) {
            const body = {};
            body[item.id] = item.value;
            return this._fetch('/settings', { method: 'PUT', body: JSON.stringify(body) });
        }

        async saveReview(pid, { rating, comment }) {
            const data = await this._fetch('/products/' + pid + '/reviews', { method: 'POST', body: JSON.stringify({ rating, comment }) });
            return data.review;
        }

        // ---- dedicated service methods ----
        async updateOrderStatus(id, status) {
            const data = await this._fetch('/orders/' + encodeURIComponent(id) + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
            return data.order;
        }

        async setUserStatus(email, status) {
            const data = await this._fetch('/users/' + encodeURIComponent(email) + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
            return data.user;
        }

        async getStats() {
            const data = await this._fetch('/admin/stats');
            return data.stats || {};
        }
    }

    // --- AUTHENTICATION SERVICE ---
    class AuthService {
        constructor() {
            this.currentUser = JSON.parse(sessionStorage.getItem('tt_session'));
            this.updateUI();
        }

        // Legacy client-side hashing kept for the built-in self-test panel.
        async hashPassword(password, salt) {
            const enc = new TextEncoder();
            if (!salt) salt = window.crypto.getRandomValues(new Uint8Array(16));
            else if (!(salt instanceof Uint8Array)) salt = new Uint8Array(salt); 
            
            const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), {name:"PBKDF2"}, false, ["deriveBits"]);
            const hash = await window.crypto.subtle.deriveBits({name:"PBKDF2", salt: salt, iterations: 100000, hash:"SHA-256"}, keyMaterial, 256);
            return { salt: Array.from(salt), hash: Array.from(new Uint8Array(hash)) };
        }

        async login(email, password) {
            const data = await app.db._fetch('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            if (!data.user) throw new Error("No account found with that email.");
            if (data.user.status === 'banned') throw new Error("This account has been banned.");
            
            this.currentUser = { email: data.user.email, name: data.user.name, role: data.user.role };
            sessionStorage.setItem('tt_session', JSON.stringify(this.currentUser));
            this.updateUI();
            app.ui.toast("Welcome back", "success");
            
            app.ui.notify(email, "New Login", "Signed in from web client");
        }

        async register(name, email, password) {
            if (!Utils.validateEmail(email)) throw new Error("Invalid email address.");
            await app.db._fetch('/auth/register', {
                method: 'POST',
                body: JSON.stringify({ name, email, password })
            });
            app.ui.toast("Account created. Please sign in.", "success");
        }

        async logout() {
            try { await app.db._fetch('/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
            this.currentUser = null;
            sessionStorage.removeItem('tt_session');
            this.updateUI();
            app.router.go('home');
            app.ui.toast("Signed out");
        }

        // Restore the session from the httpOnly cookie after a reload.
        async restoreSession() {
            try {
                const data = await app.db._fetch('/auth/me');
                if (!data || !data.user || data.user.status === 'banned') throw new Error("no session");
                const cached = sessionStorage.getItem('tt_session');
                this.currentUser = { email: data.user.email, name: data.user.name, role: data.user.role };
                if (JSON.stringify(this.currentUser) !== cached) {
                    sessionStorage.setItem('tt_session', JSON.stringify(this.currentUser));
                }
            } catch (e) {
                // Cookie missing/expired â€” clear any stale local copy.
                this.currentUser = null;
                sessionStorage.removeItem('tt_session');
            }
            this.updateUI();
        }

        updateUI() {
            const user = this.currentUser;
            const isAdmin = user && user.role === 'admin';
            Utils.$('#nav-auth').classList.toggle('hidden', !!user);
            Utils.$('#nav-logout').classList.toggle('hidden', !user);
            Utils.$('#nav-dash').classList.toggle('hidden', !user);
            Utils.$('#nav-admin').classList.toggle('hidden', !isAdmin);
            if (user) {
                Utils.$('#dash-user').textContent = `Welcome, ${user.name}`;
                app.ui.loadNotifications();
            }
            const guestNote = Utils.$('#guest-note');
            if (guestNote) guestNote.classList.toggle('hidden', !!user);
        }

        isReg = false;
        toggleMode() {
            this.isReg = !this.isReg;
            Utils.$('#auth-title').textContent = this.isReg ? "Create Account" : "Sign In";
            Utils.$('#auth-switch').textContent = this.isReg ? "Have an account? Sign in" : "Don't have an account? Register";
            Utils.$('#group-name').classList.toggle('hidden', !this.isReg);
        }

        async handleSubmit(e) {
            e.preventDefault();
            const email = Utils.$('#auth-email').value;
            const pass = Utils.$('#auth-pass').value;
            const name = Utils.$('#auth-name').value;
            try {
                if (this.isReg) {
                    await this.register(name, email, pass);
                    this.toggleMode();
                } else {
                    await this.login(email, pass);
                    app.router.go(this.currentUser.role === 'admin' ? 'admin' : 'dashboard');
                }
            } catch (err) {
                app.ui.toast(err.message, "error");
            }
        }
    }

    // --- COMMERCE SERVICE ---
    class CommerceService {
        constructor() {
            this.cart = JSON.parse(localStorage.getItem('tt_cart')) || [];
            this.wishlist = JSON.parse(localStorage.getItem('tt_wish')) || [];
            this.compareList = JSON.parse(localStorage.getItem('tt_compare')) || [];
            this.activeCoupon = null;
            this.updateBadges();
        }

        save() {
            localStorage.setItem('tt_cart', JSON.stringify(this.cart));
            localStorage.setItem('tt_wish', JSON.stringify(this.wishlist));
            localStorage.setItem('tt_compare', JSON.stringify(this.compareList));
            this.updateBadges();
        }

        async add(product) {
            // Inventory Check
            const dbProd = await app.db.get('products', product.id);
            if(dbProd.stock <= 0) return app.ui.toast("Out of stock", "error");

            const exist = this.cart.find(i => i.id === product.id);
            if (exist) {
                if(exist.qty >= dbProd.stock) return app.ui.toast("Stock limit reached", "warning");
                exist.qty++;
            } else {
                this.cart.push({ ...product, qty: 1 });
            }
            this.save();
            app.ui.toast("Added to cart", "success");
            app.ui.renderCart();
        }

        async addByPrompt(id) {
            const p = await app.db.get('products', id);
            if (p && p.stock > 0) {
                await this.add({ id: p.id, name: p.name, price: p.price, img: p.img });
            } else {
                app.ui.toast("That product is unavailable", "error");
            }
        }

        remove(id) {
            this.cart = this.cart.filter(i => i.id !== id);
            this.save();
            app.ui.renderCart();
        }

        toggleWish(product) {
            const idx = this.wishlist.findIndex(i => i.id === product.id);
            if (idx > -1) {
                this.wishlist.splice(idx, 1);
                app.ui.toast("Removed from wishlist");
            } else {
                this.wishlist.push(product);
                app.ui.toast("Added to wishlist", "success");
            }
            this.save();
            app.ui.renderWishlist();
        }

        addToCompare(product) {
            if (this.compareList.find(i => i.id === product.id)) return app.ui.toast("Already in comparison", "warning");
            if (this.compareList.length >= 4) return app.ui.toast("Comparison is full (max 4)", "error");
            
            this.compareList.push(product);
            this.save();
            app.ui.toast("Added to comparison", "success");
        }

        removeFromCompare(id) {
            this.compareList = this.compareList.filter(i => i.id !== id);
            this.save();
            app.ui.renderCompareView();
        }

        clearCompare() {
            this.compareList = [];
            this.save();
            app.ui.renderCompareView();
        }

        updateBadges() {
            const count = this.cart.reduce((a, b) => a + b.qty, 0);
            Utils.$('#badge-cart').textContent = count;
            Utils.$('#badge-cart').classList.toggle('visible', count > 0);
            Utils.$('#badge-wish').textContent = this.wishlist.length;
            Utils.$('#badge-wish').classList.toggle('visible', this.wishlist.length > 0);
            Utils.$('#badge-compare').textContent = this.compareList.length;
            Utils.$('#badge-compare').style.opacity = this.compareList.length > 0 ? 1 : 0;
        }

        async applyCoupon() {
            const code = Utils.$('#co-coupon').value.trim().toUpperCase();
            if (!code) return;
            const coupon = await app.db.get('coupons', code);
            if (coupon) {
                this.activeCoupon = coupon;
                app.ui.toast(`Applied: ${coupon.desc}`, "success");
                app.ui.renderCart(); 
            } else {
                app.ui.toast("Invalid code", "error");
                this.activeCoupon = null;
            }
        }

        getTotals() {
            const sub = this.cart.reduce((a, b) => a + (b.price * b.qty), 0);
            const tax = sub * 0.15;
            let discount = 0;
            if (this.activeCoupon) discount = sub * this.activeCoupon.discount;
            return { sub, tax, discount, total: sub + tax - discount };
        }

        selectPayment(method, el) {
            Utils.$$('.payment-option').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            Utils.$('#co-method').value = method;
            
            if (method === 'card') {
                Utils.$('#pay-card-fields').classList.remove('hidden');
                Utils.$('#pay-mobile-fields').classList.add('hidden');
            } else {
                Utils.$('#pay-card-fields').classList.add('hidden');
                Utils.$('#pay-mobile-fields').classList.remove('hidden');
                const provider = method === 'momo' ? 'MTN Mobile Money' : 'InstaCash';
                Utils.$('#co-momo-num').placeholder = `${provider} Number`;
            }
        }

        async processCheckout(e) {
            e.preventDefault();
            if (this.cart.length === 0) return app.ui.toast("Your cart is empty", "error");

            // Strict Validations
            const phone = Utils.$('#co-phone').value;
            const email = Utils.$('#co-email').value;
            if(!Utils.validateEmail(email)) return app.ui.toast("Invalid email address", "error");
            if(!Utils.validatePhone(phone)) return app.ui.toast("Invalid phone number", "error");

            const method = Utils.$('#co-method').value;
            if (method === 'momo' || method === 'instacash') {
                const payNum = Utils.$('#co-momo-num').value;
                if(!Utils.validatePhone(payNum)) return app.ui.toast("Invalid payment number", "error");
            }

            const user = app.auth.currentUser;
            const userId = user ? user.email : 'guest_' + Utils.uuid();

            const shipping = {
                name: Utils.$('#co-name').value,
                email: email,
                address: Utils.$('#co-address').value,
                phone: phone,
                city: Utils.$('#co-city').value
            };

            const submitBtn = e.target.querySelector('button[type="submit"]');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Processing..."; }

            try {
                // Server-authoritative checkout: backend validates stock, recomputes totals,
                // locks inventory and initiates payment atomically.
                const result = await app.db._fetch('/orders', {
                    method: 'POST',
                    body: JSON.stringify({
                        items: this.cart.map(i => ({ productId: i.id, qty: i.qty })),
                        couponCode: this.activeCoupon ? this.activeCoupon.code : undefined,
                        shipping,
                        paymentMethod: method,
                        paymentNumber: (method === 'momo' || method === 'instacash') ? Utils.$('#co-momo-num').value : undefined
                    })
                });

                const order = result.order;
                const payment = result.payment || {};
                app.ui.log(`Order Placed: ${order.id} via ${method}`);

                // Card â†’ confirm the real Stripe PaymentIntent via the Payment Element.
                if (method === 'card') {
                    if (!payment.clientSecret) throw new Error("Card payment could not be initiated.");
                    const stripe = await this.loadStripe();
                    if (!stripe) throw new Error("Stripe could not be loaded. Try again.");
                    const elements = stripe.elements({ clientSecret: payment.clientSecret });
                    const element = elements.create('payment');
                    const mount = Utils.$('#stripe-element-mount');
                    mount.innerHTML = '';
                    mount.classList.remove('hidden');
                    element.mount(mount);
                    const { error } = await stripe.confirmPayment({
                        elements,
                        clientSecret: payment.clientSecret,
                        confirmParams: { return_url: location.origin + '/#home' },
                        redirect: 'if_required'
                    });
                    if (error) throw new Error(error.message || "Payment was not completed.");
                }

                this.cart = [];
                this.activeCoupon = null;
                this.save();
                app.ui.toast("Order confirmed", "success");

                if (payment.instructions && method !== 'card') {
                    app.ui.toast(payment.instructions, 'info');
                }

                if (user) app.ui.notify(userId, "Order Confirmed", `Order #${order.id.substring(0,8)} received. Total: ${Utils.formatMoney(order.total)}`);

                if (user) app.router.go('dashboard');
                else app.router.go('home');
            } catch (err) {
                app.ui.toast(err.message || "Checkout Failed", "error");
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirm Order"; }
            }
        }

        async loadStripe() {
            const publicSettings = app.db._publicSettings || {};
            const key = publicSettings.stripePublishableKey || null;
            if (!key) return null;
            if (!window.Stripe) {
                await new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = 'https://js.stripe.com/v3/';
                    s.onload = resolve;
                    s.onerror = () => reject(new Error("Failed to load Stripe"));
                    document.head.appendChild(s);
                });
            }
            return window.Stripe ? window.Stripe(key) : null;
        }
    }

    // --- CONTACT SERVICE ---
    class ContactService {
        async send(e) {
            e.preventDefault();
            const form = e.target;
            const btn = form.querySelector('button');
            const originalText = btn.textContent;
            btn.textContent = "Sending...";
            btn.disabled = true;

            const formData = new FormData(form);
            const object = Object.fromEntries(formData);

            try {
                const result = await app.db._fetch('/contact', {
                    method: "POST",
                    body: JSON.stringify({
                        name: object.name || "",
                        email: object.email || "",
                        message: object.message || ""
                    })
                });
                app.ui.toast(result.message || "Message sent", "success");
                form.reset();
            } catch (error) {
                app.ui.toast(error.message || "Network error", "error");
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
    }

    // --- ADMIN SERVICE ---
    class AdminService {
        async render() {
            if (!app.auth.currentUser || app.auth.currentUser.role !== 'admin') return;

            const products = await app.db.getAll('products');
            const orders = await app.db.getAll('orders');
            const users = await app.db.getAll('users');
            const logs = await app.db.getAll('logs');
            const settings = await app.db.getAll('settings');
            const coupons = await app.db.getAll('coupons');

            // Analytics
            const totalRev = orders.reduce((acc, curr) => acc + (curr.total || 0), 0);
            Utils.$('#stat-rev').textContent = Utils.formatMoney(totalRev);
            Utils.$('#stat-ord').textContent = orders.length;
            Utils.$('#stat-users').textContent = users.length;

            const ctx = document.getElementById('revenueChart');
            if(ctx) {
                const chartStatus = Chart.getChart(ctx);
                if (chartStatus) chartStatus.destroy();

                const dataMap = {};
                orders.sort((a,b) => a.timestamp - b.timestamp).forEach(o => {
                    const d = o.date;
                    dataMap[d] = (dataMap[d] || 0) + o.total;
                });

                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: Object.keys(dataMap),
                        datasets: [{
                            label: 'Daily Revenue (E)',
                            data: Object.values(dataMap),
                            borderColor: '#00f3ff',
                            backgroundColor: 'rgba(0, 243, 255, 0.1)',
                            tension: 0.4,
                            fill: true,
                            pointRadius: 4,
                            pointBackgroundColor: '#fff'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: 'white', font: { family: 'Rajdhani' } } } },
                        scales: {
                            y: { ticks: { color: '#8b9bb4', font: {family:'Rajdhani'} }, grid: { color: 'rgba(255,255,255,0.1)' } },
                            x: { ticks: { color: '#8b9bb4', font: {family:'Rajdhani'} }, grid: { color: 'rgba(255,255,255,0.1)' } }
                        }
                    }
                });
            }

            // Products Table
            const tbody = Utils.$('#admin-prod-list');
            tbody.innerHTML = '';
            if (!products.length) {
                tbody.innerHTML = `<tr><td colspan="5" style="padding:30px;">${app.ui.emptyState({
                    icon: 'fa-box-open',
                    title: 'No Products',
                    message: 'Add your first product to start selling.',
                    actions: `<button class="btn btn-sm btn-primary" onclick="app.admin.modalProduct()"><i class="fa-solid fa-plus"></i> Add Product</button>`,
                    compact: true
                })}</td></tr>`;
            }
            products.forEach(p => {
                const lowStock = p.stock < 5 ? 'color:var(--error); font-weight:bold' : '';
                tbody.innerHTML += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 15px;">${Utils.escape(p.name)}</td>
                        <td style="padding: 15px;">${Utils.escape(p.category)}</td>
                        <td style="padding: 15px; font-family:var(--font-tech);">${Utils.formatMoney(p.price)}</td>
                        <td style="padding: 15px; ${lowStock}">${p.stock}</td>
                        <td style="padding: 15px;">
                            <button class="btn btn-sm btn-secondary" onclick="app.admin.edit(${p.id})"><i class="fa-solid fa-pen"></i></button>
                            <button class="btn btn-sm btn-danger" onclick="app.admin.delete(${p.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `;
            });
            
            // Coupon List
            const coupBody = Utils.$('#adm-coupon-list');
            coupBody.innerHTML = coupons.length ? coupons.map(c => `
                <div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                    <span><strong style="color:var(--primary)">${c.code}</strong> (${c.discount*100}%)</span>
                    <button class="btn-link" style="color:var(--error)" onclick="app.admin.deleteCoupon('${c.code}')">Del</button>
                </div>
`).join('') : app.ui.emptyState({
                icon: 'fa-ticket',
                title: 'No Coupons',
                message: 'Create discount codes to reward your customers.',
                compact: true
            });

            // User List
            const userBody = Utils.$('#admin-user-list');
            userBody.innerHTML = users.length ? users.map(u => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding:15px;">${Utils.escape(u.name)}</td>
                    <td style="padding:15px;">${Utils.escape(u.email)}</td>
                    <td style="padding:15px;">${u.role}</td>
                    <td style="padding:15px; color:${u.status === 'banned' ? 'var(--error)' : 'var(--accent)'}">${u.status || 'active'}</td>
                    <td style="padding:15px;">
                        ${u.role !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="app.admin.banUser('${u.email}')">${u.status==='banned'?'Unban':'Ban'}</button>` : ''}
                    </td>
                </tr>
            `).join('') : `<tr><td colspan="5" style="padding:30px;">${app.ui.emptyState({
                icon: 'fa-users',
                title: 'No Users Yet',
                message: 'When users register, they will appear here for management.',
                compact: true
            })}</td></tr>`;

            // Orders Table
            const ordBody = Utils.$('#admin-order-list');
            ordBody.innerHTML = '';
            const sortedOrders = orders.sort((a,b) => b.timestamp - a.timestamp).slice(0, 20);
            if (!sortedOrders.length) {
                ordBody.innerHTML = `<tr><td colspan="5" style="padding:30px;">${app.ui.emptyState({
                    icon: 'fa-receipt',
                    title: 'No Orders Yet',
                    message: 'Customer orders will appear here as they come in.',
                    compact: true
                })}</td></tr>`;
            }
            sortedOrders.forEach(o => {
                ordBody.innerHTML += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 15px; font-family: monospace;">${o.id.substring(0,8)}...</td>
                        <td style="padding: 15px;">${o.isGuest ? 'Guest' : o.userId}</td>
                        <td style="padding: 15px; font-family:var(--font-tech);">${Utils.formatMoney(o.total)}</td>
                        <td style="padding: 15px; color: var(--accent); font-weight:bold;">${o.status}</td>
                        <td style="padding: 15px;">
                            <select class="input-field" onchange="app.admin.updateStatus('${o.id}', this.value)" style="padding: 5px;">
                                <option value="Processing" ${o.status==='Processing'?'selected':''}>Processing</option>
                                <option value="Shipped" ${o.status==='Shipped'?'selected':''}>Shipped</option>
                                <option value="Delivered" ${o.status==='Delivered'?'selected':''}>Delivered</option>
                            </select>
                        </td>
                    </tr>
                `;
            });

            // Logs
            const logBox = Utils.$('#sys-logs');
            const recentLogs = logs.reverse().slice(0, 50);
            logBox.innerHTML = recentLogs.length ? recentLogs.map(l => 
                `<div><span style="color:var(--primary)">[${new Date(l.ts).toLocaleTimeString()}]</span> ${Utils.escape(l.msg)}</div>`
            ).join('') : app.ui.emptyState({
                icon: 'fa-scroll',
                title: 'No Logs Yet',
                message: 'System activity will be logged here.',
                compact: true
            });

            // Settings Fields
            const momoEnv = settings.find(s => s.id === 'momoEnvironment');
            if(momoEnv) Utils.$('#set-momo-env').value = momoEnv.value;

            const momoCb = settings.find(s => s.id === 'momoCallbackUrl');
            if(momoCb) Utils.$('#set-momo-cb').value = momoCb.value;

            const instaEndpoint = settings.find(s => s.id === 'instaEndpoint');
            if(instaEndpoint) Utils.$('#set-insta-endpoint').value = instaEndpoint.value;
            
            // Hero Config
            const hero = settings.find(s => s.id === 'hero_config');
            if (hero) {
                Utils.$('#set-hero-img').value = hero.value.img;
                Utils.$('#set-hero-title').value = hero.value.title;
                Utils.$('#set-hero-desc').value = hero.value.desc;
            }
        }
        
        async addCoupon() {
            const code = Utils.$('#adm-c-code').value.toUpperCase().trim();
            let val = parseFloat(Utils.$('#adm-c-val').value);
            if (!code || isNaN(val)) return app.ui.toast("Invalid input", "error");
            if (val > 1) val = val / 100; // allow whole percentages: 20 -> 20%
            if (!(val > 0) || val > 0.99) return app.ui.toast("Discount must be 1-99%", "error");
            await app.db.put('coupons', { code, discount: val, desc: `${Math.round(val*100)}% Discount` });
            this.render();
            app.ui.toast("Coupon added", "success");
            Utils.$('#adm-c-code').value = '';
        }

        async deleteCoupon(code) {
            if(confirm("Revoke Coupon?")) {
                await app.db.delete('coupons', code);
                this.render();
            }
        }

        async banUser(email) {
            const u = await app.db.get('users', email);
            const next = u.status === 'banned' ? 'active' : 'banned';
            await app.db.setUserStatus(email, next);
            this.render();
            app.ui.toast(`User ${next === 'banned' ? 'Banned' : 'Restored'}`);
        }

        async updateStatus(id, status) {
            const o = await app.db.updateOrderStatus(id, status);
            app.ui.toast(`Order ${id} updated to ${status}`);
            if (!o.isGuest) app.ui.notify(o.userId, "Order Update", `Your order is now ${status}`);
        }

        modalProduct() {
            Utils.$('#mp-title').textContent = "Add Product";
            Utils.$('#mp-id').value = '';
            Utils.$('form').reset();
            app.ui.openModal('modal-product');
        }

        async edit(id) {
            const p = await app.db.get('products', id);
            Utils.$('#mp-title').textContent = "Edit Product";
            Utils.$('#mp-id').value = p.id;
            Utils.$('#mp-name').value = p.name;
            Utils.$('#mp-price').value = p.price;
            Utils.$('#mp-stock').value = p.stock;
            Utils.$('#mp-cat').value = p.category;
            
            const imgList = p.images && p.images.length > 0 ? p.images.join('\n') : p.img;
            Utils.$('#mp-imgs').value = imgList;
            
            Utils.$('#mp-desc').value = p.desc;
            
            let specStr = "";
            if(p.specs) {
                for (const [key, val] of Object.entries(p.specs)) {
                    specStr += `${key}: ${val}\n`;
                }
            }
            Utils.$('#mp-specs').value = specStr.trim();
            
            app.ui.openModal('modal-product');
        }

        async saveProduct(e) {
            e.preventDefault();
            const idVal = Utils.$('#mp-id').value;
            
            const rawImgs = Utils.$('#mp-imgs').value.trim().split('\n');
            const cleanImgs = rawImgs.map(x => x.trim()).filter(x => x.length > 0);
            const mainImg = cleanImgs.length > 0 ? cleanImgs[0] : '';

            const specText = Utils.$('#mp-specs').value;
            const specs = {};
            specText.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const val = parts.slice(1).join(':').trim();
                    if(key) specs[key] = val;
                }
            });

            const p = {
                id: idVal ? parseInt(idVal) : Date.now(),
                name: Utils.$('#mp-name').value,
                price: parseFloat(Utils.$('#mp-price').value),
                stock: parseInt(Utils.$('#mp-stock').value),
                category: Utils.$('#mp-cat').value,
                img: mainImg,
                images: cleanImgs,
                desc: Utils.$('#mp-desc').value,
                specs: specs
            };
            await app.db.put('products', p);
            app.ui.closeModal('modal-product');
            this.render();
            app.ui.toast("Product saved", "success");
            
            if(app.router.currentRoute === 'shop') app.ui.renderShop();
            if(app.router.currentRoute === 'home') app.router.mount('home');
        }
        
        async saveHeroConfig() {
            const config = {
                img: Utils.$('#set-hero-img').value,
                title: Utils.$('#set-hero-title').value,
                desc: Utils.$('#set-hero-desc').value
            };
            await app.db.put('settings', { id: 'hero_config', value: config });
            app.ui.toast("Hero updated");
            if (app.router.currentRoute === 'home') app.router.mount('home');
        }

        async delete(id) {
            if (confirm("Delete this product?")) {
                await app.db.delete('products', id);
                this.render();
                app.ui.toast("Product deleted", "warning");
            }
        }

        async saveSetting(key, value) {
            await app.db.put('settings', { id: key, value });
            app.ui.toast("Settings saved");
        }
        
        async exportDB() {
            const stores = ['products', 'orders', 'users', 'reviews', 'coupons', 'settings'];
            const dump = {};
            for(const s of stores) dump[s] = await app.db.getAll(s);
            
            const blob = new Blob([JSON.stringify(dump, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `towertech_backup_${Date.now()}.json`;
            a.click();
            app.ui.toast("Backup downloaded");
        }

        async importDB() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = e => {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const data = JSON.parse(ev.target.result);
                        const writable = ['products', 'coupons', 'settings'];
                        let restored = 0, skipped = [];
                        for(const store in data) {
                            if (!Array.isArray(data[store])) continue;
                            if (!writable.includes(store)) { skipped.push(store); continue; }
                            for(const item of data[store]) {
                                await app.db.put(store, item);
                                restored++;
                            }
                        }
                        app.ui.toast(`Restored ${restored} record(s)` + (skipped.length ? ` (read-only: ${skipped.join(', ')})` : ''), "success");
                        setTimeout(() => location.reload(), 1500);
                    } catch(err) {
                        app.ui.toast("Couldn't read that backup file.", "error");
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }

        async wipe() {
            if(prompt("Type 'DELETE' to confirm full system wipe:") === "DELETE") {
                await app.db.clearAll();
                localStorage.clear();
                sessionStorage.clear();
                location.reload();
            }
        }
    }

    // --- AI SERVICE (TowerTech Assistant) ---
    class AIService {
        constructor() {
            this.context = { page: 'home', lastProduct: null };
        }

        toggle() {
            const p = Utils.$('#ai-panel');
            const isHidden = getComputedStyle(p).display === 'none';
            p.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) {
                gsap.fromTo(p, {opacity:0, scale:0.8}, {opacity:1, scale:1, duration:0.3, ease:"back.out(1.7)"});
                Utils.$('#ai-input').focus();
            }
        }

        addMsg(text, type) {
            const box = Utils.$('#ai-msgs');
            const div = document.createElement('div');
            div.className = `msg ${type}`;
            div.innerHTML = type === 'bot' ? text : Utils.escape(text);
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        }

        async send() {
            const inp = Utils.$('#ai-input');
            const txt = inp.value.trim();
            if (!txt) return;
            
            this.addMsg(txt, 'user');
            inp.value = '';
            
            const typing = document.createElement('div');
            typing.className = 'msg bot'; typing.innerText = '...'; typing.id='typing';
            Utils.$('#ai-msgs').appendChild(typing);
            Utils.$('#ai-msgs').scrollTop = Utils.$('#ai-msgs').scrollHeight;

            const response = await this.processIntent(txt);
            
            typing.remove();
            this.addMsg(response, 'bot');
        }

        async processIntent(text) {
            if (!app.auth.currentUser) {
                return "Please <a class='btn-link' onclick=\"app.router.go('login')\">log in</a> to use the TowerTech assistant.";
            }

            try {
                const data = await app.db._fetch('/ai/chat', {
                    method: 'POST',
                    body: JSON.stringify({
                        message: text,
                        context: { page: this.context.page, lastProduct: this.context.lastProduct ?? null }
                    })
                });
                const reply = data.reply || {};
                const action = reply.action || {};

                if (action.navigate) {
                    app.router.go(action.navigate);
                }
                if (Array.isArray(action.addToCart)) {
                    for (const id of action.addToCart.slice(0, 4)) await app.commerce.addByPrompt(id);
                }
                if (Array.isArray(action.compare) && action.compare.length > 0) {
                    for (const id of action.compare.slice(0, 4)) {
                        const p = await app.db.get('products', id);
                        if (p) app.commerce.addToCompare({ id: p.id, name: p.name, price: p.price, img: p.img });
                    }
                }
                return reply.message || "Done.";
            } catch (err) {
                if (err.status === 401) {
                    return "Your session expired. Please <a class='btn-link' onclick=\"app.router.go('login')\">log in</a> and try again.";
                }
                return "Sorry, I couldn't reach the assistant right now. Try again shortly.";
            }
        }
    }

    // --- UI & ROUTER ---
    class UI {
        constructor() {
            this.initThree();
            this.bindEvents();
        }

        bindEvents() {
            Utils.$$('.star-select i').forEach(star => {
                star.addEventListener('click', (e) => {
                    const val = e.target.getAttribute('data-val');
                    Utils.$('#rev-rating-input').value = val;
                    Utils.$$('.star-select i').forEach(s => {
                        s.classList.toggle('active', s.getAttribute('data-val') <= val);
                    });
                });
            });
            
            const searchInput = Utils.$('#shop-search');
            if(searchInput) searchInput.oninput = Utils.debounce(() => app.shop.filter(), 300);

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    Utils.$$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
                    const aiPanel = Utils.$('#ai-panel');
                    if (aiPanel && getComputedStyle(aiPanel).display !== 'none') app.ai.toggle();
                }
            });
        }

        initThree() {
            const canvas = Utils.$('#canvas-webgl');
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
            camera.position.z = 5;

            const geo = new THREE.BufferGeometry();
            const pos = [];
            for(let i=0; i<800; i++) pos.push((Math.random()-0.5)*15, (Math.random()-0.5)*15, (Math.random()-0.5)*15);
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            
            const mat = new THREE.PointsMaterial({ color: 0x00f3ff, size: 0.02, transparent: true, opacity: 0.6 });
            const points = new THREE.Points(geo, mat);
            scene.add(points);

            let mouseX = 0, mouseY = 0;
            document.addEventListener('mousemove', (e) => {
                mouseX = (e.clientX - window.innerWidth/2) * 0.0005;
                mouseY = (e.clientY - window.innerHeight/2) * 0.0005;
            });

            const animate = () => {
                requestAnimationFrame(animate);
                points.rotation.y += 0.001;
                points.rotation.x += 0.0005;
                points.rotation.y += 0.05 * (mouseX - points.rotation.y * 0.1);
                points.rotation.x += 0.05 * (mouseY - points.rotation.x * 0.1);
                renderer.render(scene, camera);
            };
            animate();
            
            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth/window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
        }

        toggleMenu() {
            const menu = Utils.$('#nav-menu');
            menu.classList.toggle('open');
        }

        toast(msg, type='info') {
            const area = Utils.$('#toast-area');
            const el = document.createElement('div');
            el.className = `toast ${type}`;
            el.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${Utils.escape(msg)}`;
            area.appendChild(el);
            
            gsap.to(el, {opacity: 1, y: 0, duration: 0.4, ease: "back.out"});
            setTimeout(() => {
                gsap.to(el, {opacity: 0, y: -20, duration: 0.3, onComplete: () => el.remove()});
            }, 3000);
        }

        log(msg) {
            app.db.put('logs', { ts: Date.now(), msg });
            console.log(`[SYS] ${msg}`);
        }
        
        async notify(userId, title, msg) {
            await app.db.put('notifications', {
                id: Utils.uuid(),
                userId, title, msg, read: false, date: Date.now()
            });
            if (app.auth.currentUser && app.auth.currentUser.email === userId) {
                this.toast(`New Alert: ${title}`, "warning");
                this.loadNotifications();
            }
        }
        
        async loadNotifications() {
            if (!app.auth.currentUser) return;
            const all = await app.db.getAll('notifications');
            const myNotifs = all.filter(n => n.userId === app.auth.currentUser.email).reverse();
            
            const con = Utils.$('#dash-notifs');
            if (myNotifs.length === 0) {
                con.innerHTML = this.emptyState({
                    icon: 'fa-bell-slash',
                    title: 'No Notifications',
                    message: 'You\'re all caught up. New updates will appear here.',
                    compact: true
                });
            } else {
                con.innerHTML = myNotifs.map(n => `
                    <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:4px; border-left:2px solid var(--primary);">
                        <div style="font-weight:700; font-size:0.9rem;">${Utils.escape(n.title)}</div>
                        <div style="font-size:0.8rem; color:var(--text-muted);">${Utils.escape(n.msg)}</div>
                        <div style="font-size:0.7rem; text-align:right; color:var(--text-muted); margin-top:5px;">${new Date(n.date).toLocaleTimeString()}</div>
                    </div>
                `).join('');
            }
        }

        openModal(id) { Utils.$('#'+id).classList.add('open'); }
        closeModal(id) { Utils.$('#'+id).classList.remove('open'); }

        switchImage(src, el) {
            const main = Utils.$('#pd-img');
            main.onerror = () => { main.onerror = null; main.src = Utils.placeholderImg(); };
            gsap.to(main, {opacity: 0.5, duration: 0.1, onComplete: () => {
                main.src = src;
                gsap.to(main, {opacity: 1, duration: 0.2});
            }});
            Utils.$$('.gallery-thumb').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
        }
        
        switchTab(tabId) {
            Utils.$$('.tab-content').forEach(el => el.classList.remove('active'));
            Utils.$$('.tab-btn').forEach(el => el.classList.remove('active'));
            Utils.$(`#tab-${tabId}`).classList.add('active');
            const btns = document.querySelectorAll('.tab-btn');
            if(tabId === 'desc') btns[0].classList.add('active');
            if(tabId === 'specs') btns[1].classList.add('active');
            if(tabId === 'shipping') btns[2].classList.add('active');
        }

        emptyState({ icon = 'fa-box-open', title, message, actions = '', compact = false } = {}) {
            const actionsHtml = actions ? `<div class="empty-actions">${actions}</div>` : '';
            return `
                <div class="empty-state ${compact ? 'empty-state-compact' : ''}">
                    <div class="empty-state-icon"><i class="fa-solid ${icon}"></i></div>
                    <h3>${Utils.escape(title)}</h3>
                    ${message ? `<p>${message}</p>` : ''}
                    ${actionsHtml}
                </div>
            `;
        }

        renderCard(p) {
            const isLow = p.stock < 5;
            return `
                <div class="glass-panel product-card" onclick="app.router.go('product', {id: ${p.id}})">                    
                    <div class="p-img-container">
                        <img src="${p.img ? Utils.escapeAttr(p.img) : Utils.placeholderImg()}" class="p-img" loading="lazy" onload="this.classList.add('loaded')" onerror="this.onerror=null;this.src=Utils.placeholderImg();this.classList.add('loaded')" alt="${Utils.escape(p.name)}">
                        <div class="stock-badge ${isLow ? 'low' : ''}">${p.stock > 0 ? (isLow ? `Low Stock: ${p.stock}` : 'In Stock') : 'Sold Out'}</div>
                    </div>
                    <div class="p-info">
                        <div class="p-cat">${Utils.escape(p.category)}</div>
                        <h3 class="p-title">${Utils.escape(p.name)}</h3>
                        <div class="p-price">${Utils.formatMoney(p.price)}</div>
                        <div class="p-actions">
                            <button class="btn btn-sm btn-primary btn-block ${p.stock <= 0 ? 'btn-disabled' : ''}" onclick="event.stopPropagation(); app.commerce.add({id:${p.id}, name:'${Utils.escapeJs(p.name)}', price:${p.price}, img:'${Utils.escapeJs(p.img)}'})">Add</button>
                            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); app.commerce.toggleWish({id:${p.id}, name:'${Utils.escapeJs(p.name)}', price:${p.price}, img:'${Utils.escapeJs(p.img)}'})"><i class="fa-regular fa-heart"></i></button>
                            <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); app.commerce.addToCompare({id:${p.id}, name:'${Utils.escapeJs(p.name)}', price:${p.price}, img:'${Utils.escapeJs(p.img)}'})"><i class="fa-solid fa-code-compare"></i></button>
                        </div>
                    </div>
                </div>
            `;
        }

        async renderShop(filter={}) {
            const grid = Utils.$('#shop-grid');
            grid.innerHTML = Array(6).fill(0).map(() => `
                <div class="glass-panel" style="padding:20px;">
                    <div class="skeleton sk-img"></div>
                    <div class="skeleton sk-line"></div>
                    <div class="skeleton sk-line-sm"></div>
                </div>
            `).join('');
            
            let products = await app.db.getAll('products');

            if (filter.search) products = products.filter(p => p.name.toLowerCase().includes(filter.search.toLowerCase()));
            if (filter.cat && filter.cat !== 'all') products = products.filter(p => p.category === filter.cat);
            if (filter.price) products = products.filter(p => p.price <= filter.price);

            const hasFilter = filter.search || (filter.cat && filter.cat !== 'all') || (filter.price && filter.price < 10000);
            grid.innerHTML = products.length ? products.map(p => this.renderCard(p)).join('') : this.emptyState({
                icon: hasFilter ? 'fa-magnifying-glass' : 'fa-box-open',
                title: hasFilter ? 'No Matches Found' : 'No Products Yet',
                message: hasFilter
                    ? 'Nothing matches your current filters. Try widening your search or resetting the filters.'
                    : 'The store is currently empty. Check back soon for new arrivals, or browse categories you love.',
                actions: `<button class="btn btn-primary" onclick="app.shop.reset()"><i class="fa-solid fa-rotate-left"></i> Reset Filters</button><button class="btn btn-secondary" onclick="app.router.go('home')"><i class="fa-solid fa-house"></i> Go Home</button>`
            });
            gsap.fromTo('.product-card', {y: 20, opacity: 0}, {y: 0, opacity: 1, duration: 0.4, stagger: 0.05});
        }
        
        async renderCompareView() {
            const container = Utils.$('#compare-container');
            const list = app.commerce.compareList;
            
            if (list.length === 0) {
                container.innerHTML = this.emptyState({
                    icon: 'fa-code-compare',
                    title: 'Nothing to Compare',
                    message: 'Select two or more products to see their specs side by side. Use the compare button on any product card.',
                    actions: `<button class="btn btn-primary" onclick="app.router.go('shop')"><i class="fa-solid fa-store"></i> Browse Shop</button>`
                });
                const clearBtn = Utils.$('#compare-clear');
                if (clearBtn) clearBtn.style.display = 'none';
                return;
            }
            const clearBtn = Utils.$('#compare-clear');
            if (clearBtn) clearBtn.style.display = '';

            const fullProducts = [];
            for (const item of list) {
                const p = await app.db.get('products', item.id);
                if(p) fullProducts.push(p);
            }

            const allKeys = new Set();
            fullProducts.forEach(p => {
                if(p.specs) Object.keys(p.specs).forEach(k => allKeys.add(k));
            });
            const sortedKeys = Array.from(allKeys).sort();

            let html = '<div class="compare-grid">';
            
            html += '<div class="compare-column">';
            html += '<div class="compare-cell compare-header" style="height:250px; display:flex; align-items:flex-end;">Product</div>';
            html += '<div class="compare-cell compare-header">Price</div>';
            html += '<div class="compare-cell compare-header">Category</div>';
            sortedKeys.forEach(k => html += `<div class="compare-cell compare-header">${k}</div>`);
            html += '<div class="compare-cell compare-header">Action</div>';
            html += '</div>';

            fullProducts.forEach(p => {
                html += '<div class="compare-column">';
                html += `<div class="compare-cell" style="height:250px; text-align:center;">
                            <img src="${Utils.escapeAttr(p.img)}" class="compare-img">
                            <div style="margin-top:10px; font-weight:700;">${Utils.escape(p.name)}</div>
                         </div>`;
                html += `<div class="compare-cell text-accent font-tech">${Utils.formatMoney(p.price)}</div>`;
                html += `<div class="compare-cell">${Utils.escape(p.category)}</div>`;
                
                sortedKeys.forEach(k => {
                    const val = p.specs && p.specs[k] ? p.specs[k] : '-';
                    html += `<div class="compare-cell">${Utils.escape(val)}</div>`;
                });
                
                html += `<div class="compare-cell">
                            <button class="btn btn-sm btn-primary" onclick="app.commerce.add({id:${p.id}, name:'${Utils.escapeJs(p.name)}', price:${p.price}, img:'${Utils.escapeJs(p.img)}'})"><i class="fa-solid fa-cart-plus"></i></button>
                            <button class="btn btn-sm btn-danger" onclick="app.commerce.removeFromCompare(${p.id})"><i class="fa-solid fa-times"></i></button>
                         </div>`;
                html += '</div>';
            });

            html += '</div>';
            container.innerHTML = html;
        }

        async renderReviews(pid) {
            const list = Utils.$('#review-list');
            const reviews = await app.db.getReviews(pid);
            const productReviews = reviews.reverse();
            const avg = productReviews.length ? (productReviews.reduce((a,b) => a + b.rating, 0) / productReviews.length).toFixed(1) : 0;
            const stars = Array(5).fill(0).map((_, i) => `<i class="${i < Math.round(avg) ? 'fa-solid' : 'fa-regular'} fa-star"></i>`).join('');
            Utils.$('#pd-rating').innerHTML = `${stars} (${productReviews.length} Reviews)`;

            if (productReviews.length === 0) {
                list.innerHTML = this.emptyState({
                    icon: 'fa-comment-dots',
                    title: 'No Reviews Yet',
                    message: 'Be the first to share your experience with this product.',
                    compact: true
                });
            } else {
                list.innerHTML = productReviews.map(r => `
                    <div class="review-item">
                        <div class="review-head">
                            <span><i class="fa-solid fa-user"></i> ${Utils.escape(r.name)}</span>
                            <span>${new Date(r.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div class="star-rating" style="font-size:0.8rem; margin-bottom:5px;">
                            ${Array(5).fill(0).map((_, i) => `<i class="${i < r.rating ? 'fa-solid' : 'fa-regular'} fa-star"></i>`).join('')}
                        </div>
                        <div>${Utils.escape(r.comment)}</div>
                    </div>
                `).join('');
            }
        }

        async submitReview(e) {
            e.preventDefault();
            const user = app.auth.currentUser;
            if (!user) return app.ui.toast("Please sign in to write a review.", "error");
            
            const pid = parseInt(app.router.currentParams.get('id'));
            const rating = parseInt(Utils.$('#rev-rating-input').value) || 5;
            const comment = Utils.$('#rev-comment').value;

            await app.db.saveReview(pid, { rating, comment });

            Utils.$('#review-form').reset();
            app.ui.toast("Review posted", "success");
            this.renderReviews(pid);
        }

        renderCart() {
            const list = Utils.$('#cart-list');
            const cart = app.commerce.cart;
            const summaryPanel = Utils.$('#cart-summary');
            
            if (cart.length === 0) {
                list.innerHTML = this.emptyState({
                    icon: 'fa-cart-shopping',
                    title: 'Your Cart is Empty',
                    message: 'Looks like you haven\'t added anything yet. Explore the shop and find something you love.',
                    actions: `<button class="btn btn-primary" onclick="app.router.go('shop')"><i class="fa-solid fa-store"></i> Browse Products</button>`
                });
                if (summaryPanel) summaryPanel.style.display = 'none';
            } else {
                if (summaryPanel) summaryPanel.style.display = '';
                list.innerHTML = cart.map(i => `
                    <div style="display:flex; gap:20px; align-items:center; border-bottom:1px solid var(--glass-border); padding-bottom:15px;">
                        <img src="${i.img}" style="width:80px; height:80px; object-fit:cover; border-radius:8px;">
                        <div style="flex:1;">
                            <div style="font-weight:700;">${Utils.escape(i.name)}</div>
                            <div style="color:var(--primary); font-family:var(--font-tech);">${Utils.formatMoney(i.price)} x ${i.qty}</div>
                        </div>
                        <button class="btn btn-sm btn-danger" onclick="app.commerce.remove(${i.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                `).join('');
            }
            
            const t = app.commerce.getTotals();
            Utils.$('#cart-sub').textContent = Utils.formatMoney(t.sub);
            Utils.$('#cart-tax').textContent = Utils.formatMoney(t.tax);
            Utils.$('#cart-disc').textContent = '-' + Utils.formatMoney(t.discount);
            Utils.$('#cart-total').textContent = Utils.formatMoney(t.total);
            Utils.$('#co-total-disp').textContent = Utils.formatMoney(t.total);
        }

        renderWishlist() {
            const grid = Utils.$('#wishlist-grid');
            if (app.commerce.wishlist.length === 0) grid.innerHTML = this.emptyState({
                icon: 'fa-heart',
                title: 'Wishlist is Empty',
                message: 'Tap the heart on any product to save it here for later.',
                actions: `<button class="btn btn-primary" onclick="app.router.go('shop')"><i class="fa-solid fa-store"></i> Browse Products</button>`
            });
            else grid.innerHTML = app.commerce.wishlist.map(p => this.renderCard(p)).join('');
        }
    }

    class Router {
        constructor() {
            this.currentRoute = 'home';
            this.currentParams = null;
            window.addEventListener('hashchange', () => this.handle());
        }
        
        go(route, params = null) {
            let hash = '#' + route;
            if (params) {
                const query = new URLSearchParams(params).toString();
                if(query) hash += '?' + query;
            }
            window.location.hash = hash;
        }

        async handle() {
            try {
                const hash = window.location.hash.slice(1) || 'home';
                const [route, query] = hash.split('?');
                this.currentRoute = route;
                this.currentParams = new URLSearchParams(query);
                
                // Track Context for AI
                app.ai.context.page = route;

                if (route === 'dashboard' && !app.auth.currentUser) return this.go('login');
                if (route === 'admin' && (!app.auth.currentUser || app.auth.currentUser.role !== 'admin')) {
                    app.ui.toast("Access denied", "error");
                    return this.go('home');
                }

                const current = document.querySelector('section.active');
                if (current) {
                    gsap.to(current, {opacity: 0, y: -20, duration: 0.3, onComplete: () => {
                        current.classList.remove('active');
                        this.mount(route, this.currentParams);
                    }});
                } else {
                    this.mount(route, this.currentParams);
                }

                document.querySelectorAll('.nav-link').forEach(l => {
                    l.classList.remove('active');
                    if (l.dataset.route === route) l.classList.add('active');
                });
                Utils.$('#nav-menu').classList.remove('open');
            } catch (err) {
                console.error("Routing Error:", err);
                app.ui.toast("Navigation error", "error");
                this.go('home');
            }
        }

        async mount(route, params) {
            const target = document.getElementById(`view-${route}`);
            if (!target) return this.mount('404', new URLSearchParams());

            target.classList.add('active');
            gsap.fromTo(target, {opacity: 0, y: 20}, {opacity: 1, y: 0, duration: 0.4});
            window.scrollTo(0,0);

            switch(route) {
                case 'home':
                    const feat = (await app.db.getAll('products')).slice(0, 4);
                    Utils.$('#home-featured').innerHTML = feat.length
                        ? feat.map(p => app.ui.renderCard(p)).join('')
                        : app.ui.emptyState({
                            icon: 'fa-box-open',
                            title: 'No Products Yet',
                            message: 'New arrivals will appear here as soon as the store is stocked.',
                            compact: true
                        });
                    
                    const hero = await app.db.get('settings', 'hero_config');
                    if (hero && hero.value && typeof hero.value === 'object') {
                        if (hero.value.img) Utils.$('#hero-img').src = hero.value.img;
                        if (hero.value.title) Utils.$('#hero-title').innerText = hero.value.title;
                        if (hero.value.desc) Utils.$('#hero-desc').innerText = hero.value.desc;
                    }
                    break;
                case 'shop':
                    const allP = await app.db.getAll('products');
                    const cats = [...new Set(allP.map(p => p.category))];
                    const sel = Utils.$('#shop-cat');
                    if (sel.options.length === 1) cats.forEach(c => sel.appendChild(new Option(c, c)));
                    app.ui.renderShop();
                    break;
                case 'product':
                    const pid = parseInt(params.get('id'));
                    if(!pid) return app.router.go('shop'); 
                    
                    // Update AI Context
                    app.ai.context.lastProduct = pid;
                    
                    const p = await app.db.get('products', pid);
                    if (!p) return app.router.go('404');
                    if (p) {
                        const pdImg = Utils.$('#pd-img');
                        pdImg.onerror = () => { pdImg.onerror = null; pdImg.src = Utils.placeholderImg(); };
                        pdImg.src = p.img || Utils.placeholderImg();
                        Utils.$('#pd-sku').textContent = `SKU: ${p.sku || 'N/A'}`;
                        Utils.$('#pd-price').textContent = Utils.formatMoney(p.price);
                        Utils.$('#pd-stock').textContent = p.stock > 0 ? `In Stock: ${p.stock}` : 'Sold Out';
                        if(p.stock < 5) Utils.$('#pd-stock').style.color = 'var(--error)';
                        Utils.$('#pd-desc').textContent = p.desc;
                        Utils.$('#pd-cat').textContent = p.category;
                        
                        const specsTable = Utils.$('#pd-specs-table');
                        if (p.specs && Object.keys(p.specs).length > 0) {
                            specsTable.innerHTML = Object.entries(p.specs).map(([k, v]) => 
                                `<tr><td>${Utils.escape(k)}</td><td>${Utils.escape(v)}</td></tr>`
                            ).join('');
                        } else {
                            specsTable.innerHTML = '<tr><td colspan="2">No detailed specifications listed.</td></tr>';
                        }
                        
                        app.ui.switchTab('desc');

                        const btnAdd = Utils.$('#pd-btn-add');
                        btnAdd.onclick = () => app.commerce.add({...p, qty:1});
                        if(p.stock <= 0) { btnAdd.disabled = true; btnAdd.classList.add('btn-disabled'); }
                        else { btnAdd.disabled = false; btnAdd.classList.remove('btn-disabled'); }
                        
                        Utils.$('#pd-btn-wish').onclick = () => app.commerce.toggleWish({...p});
                        Utils.$('#pd-btn-compare').onclick = () => app.commerce.addToCompare({...p});
                        
                        const gallery = Utils.$('#pd-gallery');
                        let images = p.images || (p.img ? [p.img] : []);
                        
                        if(images.length > 0) {
                            gallery.innerHTML = images.map((img, i) => `
                                <div class="gallery-thumb ${i===0?'active':''}" data-src="${Utils.escapeAttr(img)}" data-index="${i}">
                                    <img src="${Utils.escapeAttr(img)}" loading="lazy" alt="Product image ${i+1}">
                                </div>
                            `).join('');
                            gallery.querySelectorAll('.gallery-thumb').forEach((thumb) => {
                                thumb.addEventListener('click', () => app.ui.switchImage(thumb.dataset.src, thumb));
                            });
                        } else gallery.innerHTML = '';
                        
                        app.ui.renderReviews(pid);

                        const allProds = await app.db.getAll('products');
                        const related = allProds.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4);
                        Utils.$('#pd-related').innerHTML = related.length 
                            ? related.map(rp => app.ui.renderCard(rp)).join('')
                            : app.ui.emptyState({
                                icon: 'fa-link-slash',
                                title: 'No Similar Products',
                                message: 'There are no other items in this category yet.',
                                compact: true
                            });
                    }
                    break;
                case 'cart': app.ui.renderCart(); break;
                case 'wishlist': app.ui.renderWishlist(); break;
                case 'compare': app.ui.renderCompareView(); break;
                case 'contact': break;
                case 'dashboard': 
                    app.ui.loadNotifications();
                    const orders = await app.db.getAll('orders');
                    const myOrders = orders.filter(o => o.userId === app.auth.currentUser.email).reverse();
                    
                    const totalSpent = myOrders.reduce((acc, curr) => acc + (curr.total || 0), 0);
                    Utils.$('#dash-total-spent').textContent = Utils.formatMoney(totalSpent);

                    Utils.$('#dash-orders-list').innerHTML = myOrders.length ? myOrders.map(o => `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                            <td style="padding:15px; font-family:monospace;">${o.id.substring(0,8)}...</td>
                            <td style="padding:15px;">${o.date}</td>
                            <td style="padding:15px; font-family:var(--font-tech);">${Utils.formatMoney(o.total)}</td>
                            <td style="padding:15px; color:var(--accent)">${o.status}</td>
                            <td style="padding:15px;"><button class="btn btn-sm btn-secondary">Trace</button></td>
                        </tr>
                    `).join('') : `<tr><td colspan="5" style="padding:30px;">${app.ui.emptyState({
                        icon: 'fa-receipt',
                        title: 'No Orders Yet',
                        message: 'When you place your first order, it will show up here with its status and tracking.',
                        actions: `<button class="btn btn-primary" onclick="app.router.go('shop')"><i class="fa-solid fa-store"></i> Start Shopping</button>`,
                        compact: true
                    })}</td></tr>`;
                    break;
                case 'admin': await app.admin.render(); break;
                case 'checkout':
                    const sets = await app.db.getAll('settings');
                    const publicSettings = app.db._publicSettings || {};
                    let payments = { card: true, momo: true, instacash: true };
                    try { payments = JSON.parse(publicSettings.payments || '{}'); } catch (e) { /* default all on */ }
                    Utils.$$('.payment-option').forEach(el => {
                        const method = el.getAttribute('data-method');
                        const enabled = payments[method] !== false;
                        el.classList.toggle('disabled', !enabled);
                        el.style.opacity = enabled ? '' : '0.45';
                        el.style.pointerEvents = enabled ? '' : 'none';
                    });
                    const u = app.auth.currentUser;
                    if (u) {
                        Utils.$('#co-name').value = u.name;
                        Utils.$('#co-email').value = u.email;
                        Utils.$('#co-coupon').value = '';
                    }
                    const cardEnabled = payments.card !== false;
                    if (cardEnabled) {
                        app.commerce.selectPayment('card', Utils.$('.payment-option[data-method="card"]'));
                    } else {
                        const firstEnabled = Utils.$$('.payment-option:not(.disabled)')[0];
                        if (firstEnabled) app.commerce.selectPayment(firstEnabled.getAttribute('data-method'), firstEnabled);
                    }
                    break;
            }
        }
    }

    // --- MAIN APP OBJECT ---
    const app = {
        db: new Database(),
        auth: new AuthService(),
        commerce: new CommerceService(),
        admin: new AdminService(),
        contact: new ContactService(),
        ai: new AIService(),
        ui: new UI(),
        router: new Router(),
        
        shop: {
            filter: () => {
                app.ui.renderShop({
                    search: Utils.$('#shop-search').value,
                    cat: Utils.$('#shop-cat').value,
                    price: Utils.$('#shop-range').value
                });
                Utils.$('#price-val').textContent = Utils.formatMoney(Utils.$('#shop-range').value);
            },
            toggleFilters: () => {
                Utils.$('.filter-panel').classList.toggle('open');
            },
            reset: () => {
                Utils.$('#shop-search').value = '';
                Utils.$('#shop-cat').value = 'all';
                Utils.$('#shop-range').value = 10000;
                app.shop.filter();
            }
        },
        
        test: {
            run: async () => {
                app.ui.log("Running system checks...");
                try {
                    const h = await app.auth.hashPassword("test");
                    if(!h.hash) throw "Password hashing failed";
                    app.ui.toast("Security check passed", "success");

                    const health = await app.db._fetch('/health');
                    if(health.status !== 'ok') throw "Backend not healthy";
                    app.ui.toast("Backend API connected", "success");

                    const products = await app.db.getAllProducts();
                    if(products.length === 0) throw "No catalog data";
                    app.ui.toast(`Catalog OK (${products.length} items)`, "success");

                    app.ui.toast("All checks passed", "success");
                } catch(e) {
                    app.ui.toast("Check failed: " + e, "error");
                }
            },
            reportBug: async (e) => {
                e.preventDefault();
                const sev = Utils.$('#bug-sev').value;
                const desc = Utils.$('#bug-desc').value;
                const email = (app.auth.currentUser && app.auth.currentUser.email) || 'anonymous@towertech.sz';
                const page = app.router.currentRoute || 'unknown';

                try {
                    const result = await app.db._fetch('/bugs', {
                        method: "POST",
                        body: JSON.stringify({ email, message: `[${sev}] ${desc}`, page })
                    });
                    app.ui.toast(result.message || "Report sent. Thank you!", "success");
                    app.ui.closeModal('modal-bug');
                    Utils.$('#bug-desc').value = '';
                } catch(err) {
                    app.ui.toast(err.message || "Could not send report", "error");
                }
            }
        }
    };

    // --- BOOTSTRAP ---
    window.app = app; 
    window.onload = async () => {
        await app.db.init();
        await app.auth.restoreSession();
        
        gsap.to('#loader', {opacity: 0, duration: 0.5, onComplete: () => {
            Utils.$('#loader').remove();
        }});

        app.router.handle();

        if ('serviceWorker' in navigator) {
            const swCode = `
                const CACHE = 'towertech-v0-0-1';
                const ASSETS = ['/', '/app.js', '/styles.css', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'];
                self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
                self.addEventListener('fetch', e => e.respondWith(
                    caches.match(e.request).then(r => r || fetch(e.request).catch(() => new Response("Offline Mode")))
                ));
            `;
            const blob = new Blob([swCode], {type: 'text/javascript'});
            navigator.serviceWorker.register(URL.createObjectURL(blob))
                .then(() => app.ui.log("Service Worker Active"))
                .catch(e => app.ui.log("SW Error: " + e));
        }
    };

})();
