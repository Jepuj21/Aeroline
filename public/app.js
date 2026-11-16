// Centraliza la URL de la API local servida por JSON Server.
const API_ROOT = "";

// Simula una API JSON con datos guardados en el navegador para la publicación estática.
class LocalJsonStore {
  constructor(seedUrl) {
    this.seedUrl = seedUrl;
    this.storageKey = "bitjet-demo-data-v1";
    this.data = null;
  }

  // Carga el estado del navegador o inicializa una copia desde el JSON público.
  async load() {
    const savedData = window.localStorage.getItem(this.storageKey);

    if (savedData !== null) {
      this.data = JSON.parse(savedData);
    } else {
      const response = await fetch(this.seedUrl);

      if (!response.ok) {
        throw new Error(`No se pudo cargar el JSON inicial: HTTP ${response.status}`);
      }

      this.data = await response.json();
      this.save();
    }

    if (!this.data || !Array.isArray(this.data.flights)
      || !Array.isArray(this.data.users) || !Array.isArray(this.data.reservations)) {
      throw new Error("El JSON local no tiene las colecciones esperadas.");
    }
  }

  // Atiende las consultas y cambios que la aplicación hace a las colecciones JSON.
  async request(path, options = {}) {
    if (!this.data) {
      await this.load();
    }

    const url = new URL(path, window.location.origin);
    const [, collection, recordId] = url.pathname.split("/");
    const records = this.data[collection];

    if (!Array.isArray(records)) {
      throw new Error(`La colección "${collection}" no existe.`);
    }

    const method = options.method || "GET";

    if (method === "GET") {
      if (recordId) {
        const record = records.find((item) => String(item.id) === decodeURIComponent(recordId));

        if (!record) {
          throw new Error(`No se encontró el registro ${recordId}.`);
        }

        return this.copy(record);
      }

      let result = records.filter((record) =>
        [...url.searchParams.entries()].every(([key, value]) =>
          key.startsWith("_") || String(record[key]) === value
        )
      );
      const sortFields = url.searchParams.get("_sort");

      if (sortFields) {
        const descending = url.searchParams.get("_order") === "desc";
        result = [...result].sort((first, second) => {
          for (const field of sortFields.split(",")) {
            const comparison = String(first[field] ?? "").localeCompare(String(second[field] ?? ""));

            if (comparison) {
              return descending ? -comparison : comparison;
            }
          }

          return 0;
        });
      }

      return this.copy(result);
    }

    const body = options.body ? JSON.parse(options.body) : {};

    if (method === "POST") {
      if (body.id === undefined) {
        const numericIds = records.map((record) => Number(record.id)).filter(Number.isFinite);
        body.id = Math.max(0, ...numericIds) + 1;
      }

      records.push(body);
      this.save();
      return this.copy(body);
    }

    if (method === "PATCH") {
      const record = records.find((item) => String(item.id) === decodeURIComponent(recordId || ""));

      if (!record) {
        throw new Error(`No se encontró el registro ${recordId}.`);
      }

      Object.assign(record, body);
      this.save();
      return this.copy(record);
    }

    throw new Error(`El método ${method} no está disponible en el modo de demostración.`);
  }

  // Guarda cualquier cambio en el almacenamiento local de este navegador.
  save() {
    window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
  }

  // Devuelve una copia para evitar modificar datos sin persistirlos explícitamente.
  copy(value) {
    return JSON.parse(JSON.stringify(value));
  }
}

// Controla el estado, la interfaz y las operaciones principales de Bitjet.
class BitjetApp {
  // Mantiene el estado y los elementos de la interfaz dentro de una instancia.
  constructor() {
    this.currentUser = null;
    this.flightsCache = [];
    this.localStore = this.usesJsonServer()
      ? null
      : new LocalJsonStore("/db.json");
    this.elements = {
      accountToggle: document.querySelector("#account-toggle"),
      registerToggle: document.querySelector("#register-toggle"),
      reservationsToggle: document.querySelector("#reservations-toggle"),
      agentToggle: document.querySelector("#agent-toggle"),
      logoutButton: document.querySelector("#logout-button"),
      loginDialog: document.querySelector("#login-dialog"),
      registerDialog: document.querySelector("#register-dialog"),
      emailDialog: document.querySelector("#email-dialog"),
      confirmationDialog: document.querySelector("#confirmation-dialog"),
      confirmationTitle: document.querySelector("#confirmation-title"),
      confirmationMessage: document.querySelector("#confirmation-message"),
      confirmationAccept: document.querySelector("#confirmation-accept"),
      emailClose: document.querySelector("#email-close"),
      emailDone: document.querySelector("#email-done"),
      emailRecipient: document.querySelector("#email-recipient"),
      emailSubject: document.querySelector("#email-subject"),
      emailGreeting: document.querySelector("#email-greeting"),
      emailMessage: document.querySelector("#email-message"),
      emailDetails: document.querySelector("#email-details"),
      loginClose: document.querySelector("#login-close"),
      registerClose: document.querySelector("#register-close"),
      loginForm: document.querySelector("#login-form"),
      registerForm: document.querySelector("#register-form"),
      accountType: document.querySelector("#account-type"),
      corporateFields: document.querySelector("#corporate-fields"),
      searchForm: document.querySelector("#search-form"),
      searchMessage: document.querySelector("#search-message"),
      flightsPage: document.querySelector("#flights-page"),
      flightResults: document.querySelector("#flight-results"),
      profileSection: document.querySelector("#profile-section"),
      reservationList: document.querySelector("#reservation-list"),
      milesBalance: document.querySelector("#miles-balance"),
      agentSection: document.querySelector("#agent-section"),
      newFlightForm: document.querySelector("#new-flight-form"),
      agentFlightList: document.querySelector("#agent-flight-list")
    };
  }

  // Conserva JSON Server en el puerto de desarrollo y usa localStorage en sitios estáticos.
  usesJsonServer() {
    return ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "3000";
  }

  // Ejecuta la carga inicial y conecta las acciones de la página.
  // Carga los vuelos, restaura la sesión del navegador y conecta los formularios.
  async initialize() {
    this.bindEvents();

    try {
      await this.loadFlights();
      const savedUserId = sessionStorage.getItem("bitjetUserId");

      if (savedUserId) {
        this.currentUser = await this.api(`/users/${encodeURIComponent(savedUserId)}`);
        await this.updateAccountView();
      } else {
        this.renderFlights(this.flightsCache);
        this.syncPageFromLocation();
      }
    } catch (error) {
      this.showMessage(this.elements.searchMessage, `No se pudieron cargar los datos locales: ${error.message}`, "error");
      this.elements.flightResults.innerHTML = "";
    }
  }

  // Asocia los envíos y botones con sus manejadores correspondientes.
  bindEvents() {
    this.elements.accountToggle.addEventListener("click", () => this.toggleAccount("login"));
    this.elements.registerToggle.addEventListener("click", () => this.toggleAccount("register"));
    this.elements.reservationsToggle.addEventListener("click", this.toggleReservationsPanel.bind(this));
    this.elements.agentToggle.addEventListener("click", () => this.navigateToPage("gestion-vuelos"));
    this.elements.loginClose.addEventListener("click", () => this.elements.loginDialog.close());
    this.elements.registerClose.addEventListener("click", () => this.elements.registerDialog.close());
    this.elements.emailClose.addEventListener("click", () => this.elements.emailDialog.close());
    this.elements.emailDone.addEventListener("click", () => this.elements.emailDialog.close());
    this.elements.logoutButton.addEventListener("click", this.logout.bind(this));
    this.elements.searchForm.addEventListener("submit", this.searchFlights.bind(this));
    this.elements.loginForm.addEventListener("submit", this.login.bind(this));
    this.elements.registerForm.addEventListener("submit", this.register.bind(this));
    this.elements.accountType.addEventListener("change", this.syncCorporateFields.bind(this));
    this.syncCorporateFields();
    this.elements.flightResults.addEventListener("click", this.handleFlightAction.bind(this));
    this.elements.reservationList.addEventListener("click", this.handleReservationAction.bind(this));
    this.elements.newFlightForm.addEventListener("submit", this.addFlight.bind(this));
    this.elements.agentFlightList.addEventListener("submit", this.updateFlight.bind(this));
    window.addEventListener("hashchange", this.syncPageFromLocation.bind(this));
    window.addEventListener("popstate", this.syncPageFromLocation.bind(this));
  }

  // Muestra los datos de compañía solo para cuentas corporativas y los exige en ese caso.
  syncCorporateFields() {
    const isCorporate = this.elements.accountType.value === "corporate";
    this.elements.corporateFields.hidden = !isCorporate;

    this.elements.corporateFields.querySelectorAll("input").forEach((input) => {
      input.required = isCorporate;

      if (!isCorporate) {
        input.value = "";
      }
    });
  }

  // Realiza solicitudes JSON y comunica los errores HTTP en lugar de ocultarlos.
  async api(path, options = {}) {
    if (this.localStore) {
      return this.localStore.request(path, options);
    }

    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Error HTTP ${response.status}`);
    }

    return response.json();
  }

  // Lee los vuelos guardados en db.json y actualiza la lista que se muestra.
  async loadFlights() {
    this.flightsCache = await this.api("/flights?_sort=date,departure");
    this.renderFlights(this.flightsCache);
  }

  // Muestra un mensaje accesible con el tipo visual solicitado.
  showMessage(target, text, kind = "") {
    target.textContent = text;

    if (kind) {
      target.dataset.kind = kind;
    } else {
      delete target.dataset.kind;
    }
  }

  // Presenta en un diálogo el mensaje que recibiría el cliente, sin enviar un correo real.
  showEmailSimulation({ recipient, subject, greeting, message, details }) {
    this.elements.emailRecipient.textContent = recipient;
    this.elements.emailSubject.textContent = subject;
    this.elements.emailGreeting.textContent = greeting;
    this.elements.emailMessage.textContent = message;
    this.elements.emailDetails.replaceChildren();

    details.forEach((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      this.elements.emailDetails.append(item);
    });

    this.elements.emailDialog.showModal();
  }

  // Pide confirmación en un diálogo visible dentro de la aplicación.
  showConfirmation({ title, message, confirmLabel }) {
    const dialog = this.elements.confirmationDialog;
    this.elements.confirmationTitle.textContent = title;
    this.elements.confirmationMessage.textContent = message;
    this.elements.confirmationAccept.textContent = confirmLabel;
    dialog.returnValue = "";

    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "confirm");
      }, { once: true });
      dialog.showModal();
    });
  }

  // Escapa valores del JSON antes de insertarlos en plantillas HTML.
  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  // Formatea precios en pesos dominicanos para esta demostración local.
  formatCurrency(amount) {
    return new Intl.NumberFormat("es-DO", {
      style: "currency",
      currency: "DOP",
      maximumFractionDigits: 0
    }).format(Number(amount) || 0);
  }

  // Formatea una fecha local sin desplazarla al día anterior por la zona horaria.
  formatDate(date) {
    if (!date) {
      return "Fecha no disponible";
    }

    return new Intl.DateTimeFormat("es-DO", {
      dateStyle: "medium"
    }).format(new Date(`${date}T12:00:00`));
  }

  // Convierte una hora de 24 horas a una etiqueta legible.
  formatTime(time) {
    return time || "Hora no disponible";
  }

  // Abre el diálogo solicitado y enfoca su primer campo.
  toggleAccount(formName) {
    const isRegister = formName === "register";
    const dialog = isRegister ? this.elements.registerDialog : this.elements.loginDialog;
    const targetForm = isRegister ? this.elements.registerForm : this.elements.loginForm;
    if (isRegister) {
      this.syncCorporateFields();
    }

    dialog.showModal();
    targetForm.querySelector("input").focus();
  }

  // Abre la página de reservas para clientes autenticados.
  toggleReservationsPanel() {
    if (!this.currentUser || this.currentUser.role === "agent") {
      return;
    }

    this.navigateToPage("reservas");
  }

  // Cambia la vista y mantiene una ruta hash navegable e independiente.
  navigateToPage(page) {
    if (page === "reservas" && (!this.currentUser || this.currentUser.role === "agent")) {
      this.showMessage(this.elements.searchMessage, "Inicia sesión como cliente para ver tus reservas.", "error");
      if (!this.currentUser) {
        this.toggleAccount("login");
      }
      return;
    }

    if (page === "gestion-vuelos" && this.currentUser?.role !== "agent") {
      this.showMessage(this.elements.searchMessage, "La gestión de vuelos es exclusiva para agentes.", "error");
      return;
    }

    const hash = `#${page}`;
    if (location.hash !== hash) {
      history.pushState({ page }, "", hash);
    }
    this.setActivePage(page);
  }

  // Restaura la vista apropiada cuando se abre un enlace o se usa atrás/adelante.
  syncPageFromLocation() {
    const requestedPage = location.hash.slice(1) || "inicio";
    const validPages = ["inicio", "reservas", "gestion-vuelos"];
    const page = validPages.includes(requestedPage) ? requestedPage : "inicio";

    if (page === "reservas" && (!this.currentUser || this.currentUser.role === "agent")) {
      history.replaceState(null, "", "#inicio");
      this.setActivePage("inicio");
      this.showMessage(this.elements.searchMessage, "Inicia sesión como cliente para ver tus reservas.", "error");
      if (!this.currentUser) {
        this.toggleAccount("login");
      }
      return;
    }

    if (page === "gestion-vuelos" && this.currentUser?.role !== "agent") {
      history.replaceState(null, "", "#inicio");
      this.setActivePage("inicio");
      this.showMessage(this.elements.searchMessage, "La gestión de vuelos es exclusiva para agentes.", "error");
      return;
    }

    this.setActivePage(page);
  }

  // Muestra solo la página solicitada y actualiza el estado de navegación accesible.
  setActivePage(page) {
    const isReservationsPage = page === "reservas";
    const isAgentPage = page === "gestion-vuelos";
    this.elements.flightsPage.hidden = page !== "inicio";
    this.elements.profileSection.hidden = !isReservationsPage;
    this.elements.agentSection.hidden = !isAgentPage;
    this.elements.reservationsToggle.setAttribute("aria-expanded", String(isReservationsPage));
    this.elements.agentToggle.setAttribute("aria-expanded", String(isAgentPage));
    this.elements.reservationsToggle.classList.toggle("is-active", isReservationsPage);
    this.elements.agentToggle.classList.toggle("is-active", isAgentPage);
  }

  // Filtra los vuelos locales por ruta, fecha y hora de salida seleccionadas.
  async searchFlights(event) {
    event.preventDefault();
    const formData = new FormData(this.elements.searchForm);
    const origin = String(formData.get("origin")).trim().toLowerCase();
    const destination = String(formData.get("destination")).trim().toLowerCase();
    const date = String(formData.get("date"));
    const departureAfter = String(formData.get("departureAfter"));

    try {
      await this.loadFlights();
      const matches = this.flightsCache.filter((flight) => {
        const originMatches = !origin
          || flight.origin.toLowerCase().includes(origin)
          || flight.originName.toLowerCase().includes(origin);
        const destinationMatches = !destination
          || flight.destination.toLowerCase().includes(destination)
          || flight.destinationName.toLowerCase().includes(destination);
        const dateMatches = !date || flight.date === date;
        const timeMatches = !departureAfter || flight.departure >= departureAfter;
        return originMatches && destinationMatches && dateMatches && timeMatches;
      });

      this.renderFlights(matches);
      this.showMessage(
        this.elements.searchMessage,
        matches.length ? `${matches.length} vuelo(s) encontrado(s).` : "No hay vuelos para esos criterios; prueba otra fecha u hora.",
        matches.length ? "success" : ""
      );
    } catch (error) {
      this.showMessage(this.elements.searchMessage, `No se pudo completar la búsqueda: ${error.message}`, "error");
    }
  }

  // Dibuja las tarjetas de vuelo y habilita la reserva únicamente a clientes.
  renderFlights(flights) {
    if (!flights.length) {
      this.elements.flightResults.innerHTML = '<p class="booking-hint">No hay vuelos para mostrar.</p>';
      return;
    }

    this.elements.flightResults.innerHTML = flights.map((flight) => {
      const freeSeats = flight.seats.filter((seat) => !flight.occupiedSeats.includes(seat));
      const seatOptions = freeSeats.map((seat) =>
        `<option value="${this.escapeHtml(seat)}">${this.escapeHtml(seat)}</option>`
      ).join("");
      const canBook = this.currentUser && this.currentUser.role !== "agent";
      const mileageInput = this.currentUser?.role === "corporate"
        ? `<label>Millas a canjear (1 milla = 1 DOP)
             <input name="miles" type="number" min="0" max="${Math.min(this.currentUser.miles, flight.price)}" step="1" value="0">
           </label>`
        : "";
      let bookingContent = "";

      if (flight.status === "Cancelado") {
        bookingContent = '<p class="booking-hint">Este vuelo está cancelado.</p>';
      } else if (!freeSeats.length) {
        bookingContent = '<p class="booking-hint">No hay asientos disponibles.</p>';
      } else if (canBook) {
        bookingContent = `
          <label>Asiento
            <select name="seat">${seatOptions}</select>
          </label>
          ${mileageInput}
          <button class="button button-primary reserve-action-button" type="button" data-action="reserve" data-flight-id="${this.escapeHtml(flight.id)}">Reservar vuelo</button>
        `;
      } else if (this.currentUser?.role === "agent") {
        bookingContent = '<p class="booking-hint"><button class="inline-link" type="button" data-action="open-login">Inicia sesión</button> como cliente para reservar.</p>';
      } else {
        bookingContent = '<p class="booking-hint"><button class="inline-link" type="button" data-action="open-login">Inicia sesión</button> como cliente registrado para seleccionar un asiento y reservar.</p>';
      }

      return `
        <article class="flight-card">
          <div class="flight-main">
            <span class="flight-number">${this.escapeHtml(flight.id)}</span>
            <div class="route">
              <div class="route-point">
                <strong>${this.escapeHtml(flight.origin)}</strong>
                <span>${this.escapeHtml(flight.originName)}</span>
              </div>
              <span class="route-arrow" aria-hidden="true">→</span>
              <div class="route-point">
                <strong>${this.escapeHtml(flight.destination)}</strong>
                <span>${this.escapeHtml(flight.destinationName)}</span>
              </div>
            </div>
            <div class="flight-meta">
              <span>${this.escapeHtml(this.formatDate(flight.date))}</span>
              <span>Salida ${this.escapeHtml(this.formatTime(flight.departure))}</span>
              <span>Llegada ${this.escapeHtml(this.formatTime(flight.arrival))}</span>
              <span>${freeSeats.length} asiento(s) disponible(s)</span>
            </div>
            <span class="flight-status" data-status="${this.escapeHtml(flight.status)}">${this.escapeHtml(flight.status)}</span>
          </div>
          <div class="booking-box">
            <span class="fare">${this.escapeHtml(this.formatCurrency(flight.price))}</span>
            ${bookingContent}
          </div>
        </article>
      `;
    }).join("");
  }

  // Inicia sesión contra las cuentas locales y restaura el panel adecuado al rol.
  async login(event) {
    event.preventDefault();
    const message = document.querySelector("#login-message");
    const formData = new FormData(this.elements.loginForm);
    const email = String(formData.get("email")).trim().toLowerCase();
    const password = String(formData.get("password"));

    try {
      const users = await this.api(`/users?email=${encodeURIComponent(email)}`);
      const user = users.find((candidate) => candidate.password === password);

      if (!user) {
        this.showMessage(message, "Correo o contraseña incorrectos.", "error");
        return;
      }

      this.currentUser = user;
      sessionStorage.setItem("bitjetUserId", String(user.id));
      await this.updateAccountView();
      this.elements.loginDialog.close();
      this.showMessage(this.elements.searchMessage, `Sesión iniciada. Bienvenido/a, ${user.name}.`, "success");
      if (user.role === "agent") {
        this.navigateToPage("gestion-vuelos");
      }
    } catch (error) {
      this.showMessage(message, `No se pudo iniciar sesión: ${error.message}`, "error");
    }
  }

  // Registra una cuenta minorista o corporativa con los datos del formulario.
  async register(event) {
    event.preventDefault();
    const message = document.querySelector("#register-message");
    const formData = new FormData(this.elements.registerForm);
    const accountType = String(formData.get("accountType"));
    const company = String(formData.get("company")).trim();
    const rnc = String(formData.get("rnc")).trim();
    const email = String(formData.get("email")).trim().toLowerCase();

    if (accountType === "corporate" && (!company || !rnc)) {
      this.showMessage(message, "Para una cuenta corporativa, completa tanto la compañía como el RNC.", "error");
      return;
    }

    try {
      const existingUsers = await this.api(`/users?email=${encodeURIComponent(email)}`);

      if (existingUsers.length) {
        this.showMessage(message, "Ese correo ya está registrado.", "error");
        return;
      }

      // Las contraseñas en texto claro y la autenticación JSON solo son aptas para demostración local.
      // Sugerencia para producción: usar un servidor con contraseñas cifradas y sesiones seguras.
      const user = await this.api("/users", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name")).trim(),
          address: String(formData.get("address")).trim(),
          phone: String(formData.get("phone")).trim(),
          email,
          password: String(formData.get("password")),
          company,
          rnc,
          role: accountType,
          miles: 0
        })
      });

      const customerName = user.name;
      this.currentUser = user;
      sessionStorage.setItem("bitjetUserId", String(user.id));
      this.elements.registerForm.reset();
      this.syncCorporateFields();
      await this.updateAccountView();
      this.elements.registerDialog.close();
      this.showMessage(this.elements.searchMessage, "Cuenta creada. Mostramos el correo de bienvenida de demostración.", "success");
      this.showEmailSimulation({
        recipient: user.email,
        subject: "¡Te damos la bienvenida a Bitjet!",
        greeting: `Hola, ${customerName}:`,
        message: "Tu cuenta fue creada correctamente. Ya puedes buscar vuelos y preparar tu próximo viaje.",
        details: [
          `Tipo de cuenta: ${accountType === "corporate" ? "Corporativa" : "Minorista"}`,
          `Correo de la cuenta: ${user.email}`
        ]
      });
    } catch (error) {
      this.showMessage(message, `No se pudo crear la cuenta: ${error.message}`, "error");
    }
  }

  // Actualiza el encabezado, los vuelos y el módulo autorizado para el rol actual.
  async updateAccountView() {
    this.elements.accountToggle.hidden = Boolean(this.currentUser);
    this.elements.registerToggle.hidden = Boolean(this.currentUser);
    this.elements.logoutButton.hidden = !this.currentUser;
    this.elements.reservationsToggle.hidden = !this.currentUser || this.currentUser.role === "agent";
    this.elements.agentToggle.hidden = !this.currentUser || this.currentUser.role !== "agent";

    if (this.currentUser) {
      this.elements.logoutButton.textContent = `Cerrar sesión (${this.currentUser.name})`;
    }

    const isClient = Boolean(this.currentUser) && this.currentUser.role !== "agent";
    this.elements.profileSection.hidden = true;
    this.elements.agentSection.hidden = true;
    await this.loadFlights();

    if (this.currentUser?.role === "agent") {
      await this.renderAgentFlights();
    } else if (isClient) {
      this.elements.milesBalance.textContent = this.currentUser.role === "corporate"
        ? `Saldo: ${this.currentUser.miles} millas`
        : "Cuenta minorista";
      await this.renderReservations();
    }

    this.syncPageFromLocation();
  }

  // Cierra la sesión del navegador y conserva visibles los vuelos públicos.
  logout() {
    this.currentUser = null;
    sessionStorage.removeItem("bitjetUserId");
    this.elements.accountToggle.hidden = false;
    this.elements.registerToggle.hidden = false;
    this.elements.reservationsToggle.hidden = true;
    this.elements.agentToggle.hidden = true;
    this.elements.reservationsToggle.setAttribute("aria-expanded", "false");
    this.elements.reservationsToggle.classList.remove("is-active");
    this.elements.agentToggle.setAttribute("aria-expanded", "false");
    this.elements.agentToggle.classList.remove("is-active");
    this.elements.logoutButton.hidden = true;
    history.replaceState(null, "", "#inicio");
    this.setActivePage("inicio");
    this.renderFlights(this.flightsCache);
  }

  // Maneja la reserva de un asiento y la acumulación o redención de millas.
  async handleFlightAction(event) {
    const loginLink = event.target.closest("[data-action='open-login']");
    if (loginLink) {
      this.toggleAccount("login");
      return;
    }

    const button = event.target.closest("[data-action='reserve']");

    if (!button) {
      return;
    }

    if (!this.currentUser || this.currentUser.role === "agent") {
      this.showMessage(this.elements.searchMessage, "Inicia sesión con una cuenta de cliente para reservar.", "error");
      return;
    }

    const card = button.closest(".flight-card");
    const flightId = button.dataset.flightId;
    const seat = card.querySelector("[name='seat']").value;
    const milesInput = card.querySelector("[name='miles']");
    const milesToUse = milesInput ? Number(milesInput.value) : 0;

    if (!Number.isInteger(milesToUse) || milesToUse < 0 || milesToUse > this.currentUser.miles) {
      this.showMessage(this.elements.searchMessage, "La cantidad de millas debe ser un número entero dentro de tu saldo.", "error");
      return;
    }

    const originalButtonHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Reservando...</span>';

    try {
      const flight = await this.api(`/flights/${encodeURIComponent(flightId)}`);
      const currentPrice = Number(flight.price);

      if (!flight.seats.includes(seat) || flight.occupiedSeats.includes(seat)) {
        await this.loadFlights();
        this.showMessage(this.elements.searchMessage, "Ese asiento ya no está disponible. Actualizamos los asientos; elige otro.", "error");
        return;
      }

      if (milesToUse > currentPrice) {
        this.showMessage(this.elements.searchMessage, "No puedes canjear más millas que el precio del vuelo.", "error");
        return;
      }

      const finalPrice = currentPrice - milesToUse;
      const milesEarned = this.currentUser.role === "corporate" ? Math.floor(finalPrice) : 0;
      const updatedMiles = Number(this.currentUser.miles || 0) - milesToUse + milesEarned;

      const reservationConfirmation = [
        `¿Confirmas la reserva del vuelo ${flight.id}?`,
        "",
        `Ruta: ${flight.originName} → ${flight.destinationName}`,
        `Fecha y salida: ${this.formatDate(flight.date)}, ${flight.departure}`,
        `Asiento: ${seat}`,
        `Total a pagar: ${this.formatCurrency(finalPrice)}`,
        ...(milesToUse ? [`Millas a canjear: ${milesToUse}`] : [])
      ].join("\n");

      const reservationConfirmed = await this.showConfirmation({
        title: "Confirmar reserva",
        message: reservationConfirmation,
        confirmLabel: "Sí, reservar"
      });

      if (!reservationConfirmed) {
        button.disabled = false;
        button.classList.remove("is-loading");
        button.innerHTML = originalButtonHtml;
        return;
      }

      const occupiedSeats = [...flight.occupiedSeats, seat];

      await this.api(`/flights/${encodeURIComponent(flight.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ occupiedSeats })
      });

      let reservation;

      try {
        reservation = await this.api("/reservations", {
          method: "POST",
          body: JSON.stringify({
            userId: this.currentUser.id,
            flightId: flight.id,
            flightNumber: flight.id,
            origin: flight.originName,
            destination: flight.destinationName,
            flightDate: flight.date,
            departure: flight.departure,
            seat,
            price: finalPrice,
            milesUsed: milesToUse,
            milesEarned,
            status: "Confirmada",
            createdAt: new Date().toISOString()
          })
        });
      } catch (error) {
        try {
          await this.api(`/flights/${encodeURIComponent(flight.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ occupiedSeats: flight.occupiedSeats })
          });
        } catch (rollbackError) {
          this.showMessage(this.elements.searchMessage, `No se guardó la reserva y no se pudo liberar el asiento: ${rollbackError.message}`, "error");
          return;
        }

        throw error;
      }

      if (this.currentUser.role === "corporate") {
        try {
          this.currentUser = await this.api(`/users/${encodeURIComponent(this.currentUser.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ miles: updatedMiles })
          });
        } catch (error) {
          this.showMessage(this.elements.searchMessage, `La reserva ${reservation.id} quedó guardada, pero no se pudo actualizar el saldo de millas: ${error.message}`, "error");
          await this.loadFlights();
          await this.renderReservations();
          return;
        }
      }

      this.showMessage(this.elements.searchMessage, `✈ Reserva ${reservation.id} confirmada. Mostramos el correo de demostración.`, "success");
      await this.updateAccountView();
      this.showEmailSimulation({
        recipient: this.currentUser.email,
        subject: `Confirmación de reserva ${reservation.id}`,
        greeting: `Hola, ${this.currentUser.name}:`,
        message: "Tu vuelo está reservado. Aquí tienes el resumen de tu viaje:",
        details: [
          `Reserva: ${reservation.id}`,
          `Vuelo: ${reservation.flightNumber}`,
          `Ruta: ${reservation.origin} → ${reservation.destination}`,
          `Fecha y salida: ${this.formatDate(reservation.flightDate)}, ${reservation.departure}`,
          `Asiento: ${reservation.seat}`,
          `Total: ${this.formatCurrency(reservation.price)}`,
          ...(milesEarned ? [`Millas acumuladas: ${milesEarned}`] : []),
          ...(milesToUse ? [`Millas canjeadas: ${milesToUse}`] : [])
        ]
      });
    } catch (error) {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.innerHTML = originalButtonHtml;
      this.showMessage(this.elements.searchMessage, `No se pudo completar la reserva: ${error.message}`, "error");
    }
  }

  // Carga las reservas del usuario y muestra su estado y las condiciones de cancelación.
  async renderReservations() {
    if (!this.currentUser || this.currentUser.role === "agent") {
      return;
    }

    const reservations = await this.api(`/reservations?userId=${encodeURIComponent(this.currentUser.id)}&_sort=createdAt&_order=desc`);

    if (!reservations.length) {
      this.elements.reservationList.innerHTML = '<p class="booking-hint">Todavía no tienes reservas.</p>';
      return;
    }

    this.elements.reservationList.innerHTML = reservations.map((reservation) => {
      const refundable = this.isRefundEligible(reservation.flightDate, reservation.departure);
      const canCancel = reservation.status === "Confirmada";
      const refundText = canCancel
        ? refundable ? "Cancelación con devolución del 80% (con al menos 7 días de anticipación)." : "Cancelación sin devolución (menos de 7 días)."
        : `Devolución registrada: ${this.formatCurrency(reservation.refundAmount || 0)}.`;

      return `
        <article class="reservation-card">
          <div>
            <span class="flight-number">Reserva ${this.escapeHtml(reservation.id)} · ${this.escapeHtml(reservation.flightNumber)}</span>
            <h3>${this.escapeHtml(reservation.origin)} → ${this.escapeHtml(reservation.destination)}</h3>
            <p class="reservation-detail">${this.escapeHtml(this.formatDate(reservation.flightDate))} · Salida ${this.escapeHtml(reservation.departure)} · Asiento ${this.escapeHtml(reservation.seat)}</p>
            <p class="reservation-detail">Estado: ${this.escapeHtml(reservation.status)} · Total: ${this.escapeHtml(this.formatCurrency(reservation.price))}</p>
            <p class="reservation-detail">${this.escapeHtml(refundText)}</p>
          </div>
          ${canCancel ? `<button class="button button-quiet" type="button" data-action="cancel" data-reservation-id="${this.escapeHtml(reservation.id)}">Cancelar reserva</button>` : ""}
        </article>
      `;
    }).join("");
  }

  // Determina si faltan al menos siete días completos para la salida del vuelo.
  isRefundEligible(flightDate, departure) {
    // El documento dice una vez "después de una semana", pero los casos detallados exigen
    // al menos siete días antes del vuelo. Se aplica el criterio detallado; sugerencia:
    // confirmar con el equipo cuál de las dos formulaciones debe prevalecer.
    const departureAt = new Date(`${flightDate}T${departure}:00`);
    const daysUntilDeparture = (departureAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return daysUntilDeparture >= 7;
  }

  // Cancela una reserva, libera su asiento y registra el reembolso aplicable.
  async handleReservationAction(event) {
    const button = event.target.closest("[data-action='cancel']");

    if (!button || !this.currentUser) {
      return;
    }

    const reservationId = button.dataset.reservationId;

    try {
      const reservation = await this.api(`/reservations/${encodeURIComponent(reservationId)}`);

      if (Number(reservation.userId) !== Number(this.currentUser.id) || reservation.status !== "Confirmada") {
        this.showMessage(this.elements.searchMessage, "La reserva ya no está disponible para cancelación.", "error");
        return;
      }

      const flight = await this.api(`/flights/${encodeURIComponent(reservation.flightId)}`);
      // El monto se registra en JSON; no se transfiere dinero en esta demostración local.
      // Sugerencia: conectar un procesador de pagos antes de habilitar devoluciones reales.
      const refundEligible = this.isRefundEligible(reservation.flightDate, reservation.departure);
      const refundAmount = refundEligible
        ? Math.round(Number(reservation.price) * 0.8)
        : 0;
      const cancellationConfirmation = refundEligible
        ? `¿Confirmas la cancelación de la reserva ${reservation.id}?\n\nFaltan al menos 7 días para el vuelo. Corresponde un reembolso simulado del 80%: ${this.formatCurrency(refundAmount)}.`
        : `¿Confirmas la cancelación de la reserva ${reservation.id}?\n\nFaltan menos de 7 días para el vuelo. No corresponde reembolso según la política de cancelación.`;

      const cancellationConfirmed = await this.showConfirmation({
        title: "Confirmar cancelación",
        message: cancellationConfirmation,
        confirmLabel: "Sí, cancelar"
      });

      if (!cancellationConfirmed) {
        this.showMessage(this.elements.searchMessage, "La cancelación no se realizó.", "");
        return;
      }

      const occupiedSeats = flight.occupiedSeats.filter((seat) => seat !== reservation.seat);

      await this.api(`/flights/${encodeURIComponent(flight.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ occupiedSeats })
      });

      try {
        await this.api(`/reservations/${encodeURIComponent(reservation.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "Cancelada",
            refundAmount,
            cancelledAt: new Date().toISOString()
          })
        });
      } catch (error) {
        try {
          await this.api(`/flights/${encodeURIComponent(flight.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ occupiedSeats: flight.occupiedSeats })
          });
        } catch (rollbackError) {
          this.showMessage(this.elements.searchMessage, `La cancelación no se guardó y no se pudo volver a ocupar el asiento: ${rollbackError.message}`, "error");
          return;
        }

        throw error;
      }

      this.showMessage(this.elements.searchMessage, `Reserva cancelada. Reembolso de demostración: ${this.formatCurrency(refundAmount)}. El correo se simula localmente.`, "success");
      await this.loadFlights();
      await this.renderReservations();
      this.showEmailSimulation({
        recipient: this.currentUser.email,
        subject: `Cancelación de reserva ${reservation.id}`,
        greeting: `Hola, ${this.currentUser.name}:`,
        message: "Tu solicitud de cancelación fue procesada. Este es el resumen:",
        details: [
          `Reserva: ${reservation.id}`,
          `Vuelo: ${reservation.flightNumber}`,
          `Ruta: ${reservation.origin} → ${reservation.destination}`,
          `Fecha y salida: ${this.formatDate(reservation.flightDate)}, ${reservation.departure}`,
          `Asiento liberado: ${reservation.seat}`,
          `Estado: Cancelada`,
          `Reembolso de demostración: ${this.formatCurrency(refundAmount)}`
        ]
      });
    } catch (error) {
      this.showMessage(this.elements.searchMessage, `No se pudo cancelar la reserva: ${error.message}`, "error");
    }
  }

  // Agrega un vuelo nuevo al JSON local cuando inicia sesión un agente.
  async addFlight(event) {
    event.preventDefault();

    if (this.currentUser?.role !== "agent") {
      this.showMessage(document.querySelector("#agent-message"), "Se requiere una cuenta de agente.", "error");
      return;
    }

    const message = document.querySelector("#agent-message");
    const formData = new FormData(this.elements.newFlightForm);
    const id = String(formData.get("flightNumber")).trim().toUpperCase();
    const seats = String(formData.get("seats")).split(",").map((seat) => seat.trim()).filter(Boolean);

    if (!seats.length || new Set(seats).size !== seats.length) {
      this.showMessage(message, "Indica al menos un asiento y evita repetir números.", "error");
      return;
    }

    try {
      const existingFlights = await this.api(`/flights?id=${encodeURIComponent(id)}`);

      if (existingFlights.length) {
        this.showMessage(message, "Ese número de vuelo ya existe.", "error");
        return;
      }

      await this.api("/flights", {
        method: "POST",
        body: JSON.stringify({
          id,
          origin: String(formData.get("origin")).trim().toUpperCase(),
          originName: String(formData.get("originName")).trim(),
          destination: String(formData.get("destination")).trim().toUpperCase(),
          destinationName: String(formData.get("destinationName")).trim(),
          date: String(formData.get("date")),
          departure: String(formData.get("departure")),
          arrival: String(formData.get("arrival")),
          price: Number(formData.get("price")),
          status: "A tiempo",
          seats,
          occupiedSeats: []
        })
      });

      this.elements.newFlightForm.reset();
      this.showMessage(message, `Vuelo ${id} agregado.`, "success");
      await this.loadFlights();
      await this.renderAgentFlights();
    } catch (error) {
      this.showMessage(message, `No se pudo agregar el vuelo: ${error.message}`, "error");
    }
  }

  // Presenta formularios de actualización para los vuelos existentes.
  async renderAgentFlights() {
    const agentFlights = await this.api("/flights?_sort=date,departure");

    this.elements.agentFlightList.innerHTML = agentFlights.map((flight) => `
      <article class="agent-flight-card">
        <h3>${this.escapeHtml(flight.id)} · ${this.escapeHtml(flight.originName)} → ${this.escapeHtml(flight.destinationName)}</h3>
        <p class="reservation-detail">${this.escapeHtml(this.formatDate(flight.date))} · ${this.escapeHtml(flight.departure)} · ${this.escapeHtml(this.formatCurrency(flight.price))} · ${flight.occupiedSeats.length}/${flight.seats.length} asientos ocupados</p>
        <form class="agent-flight-form" data-flight-id="${this.escapeHtml(flight.id)}">
          <label>Fecha<input name="date" type="date" value="${this.escapeHtml(flight.date)}" required></label>
          <label>Salida<input name="departure" type="time" value="${this.escapeHtml(flight.departure)}" required></label>
          <label>Llegada<input name="arrival" type="time" value="${this.escapeHtml(flight.arrival)}" required></label>
          <label>Precio (DOP)<input name="price" type="number" min="1" step="1" value="${this.escapeHtml(flight.price)}" required></label>
          <label>Estado
            <select name="status">
              ${["A tiempo", "Retrasado", "Adelantado", "Cancelado"].map((status) =>
                `<option value="${status}" ${flight.status === status ? "selected" : ""}>${status}</option>`
              ).join("")}
            </select>
          </label>
          <button class="button button-primary" type="submit">Guardar cambios</button>
          <p class="form-message wide-field" role="status"></p>
        </form>
      </article>
    `).join("");
  }

  // Guarda las modificaciones de horario, tarifa o estado enviadas por el agente.
  async updateFlight(event) {
    event.preventDefault();

    if (this.currentUser?.role !== "agent") {
      return;
    }

    const form = event.target;
    const formData = new FormData(form);
    const message = form.querySelector(".form-message");
    const price = Number(formData.get("price"));

    if (!Number.isFinite(price) || price <= 0) {
      this.showMessage(message, "El precio debe ser mayor que cero.", "error");
      return;
    }

    try {
      await this.api(`/flights/${encodeURIComponent(form.dataset.flightId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          date: String(formData.get("date")),
          departure: String(formData.get("departure")),
          arrival: String(formData.get("arrival")),
          price,
          status: String(formData.get("status"))
        })
      });

      this.showMessage(message, "Vuelo actualizado.", "success");
      await this.loadFlights();
      await this.renderAgentFlights();
    } catch (error) {
      this.showMessage(message, `No se pudo actualizar el vuelo: ${error.message}`, "error");
    }
  }
}

// Crea la instancia principal y arranca la aplicación cuando el documento está listo.
const bitjetApp = new BitjetApp();
document.addEventListener("DOMContentLoaded", () => bitjetApp.initialize());
