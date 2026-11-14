// Centraliza la URL de la API local servida por JSON Server.
const API_ROOT = "";

// db.json se mantiene como JSON estricto: ese formato no admite comentarios internos.
// Guarda en memoria al usuario actual y el catálogo de vuelos cargado.
let currentUser = null;
let flightsCache = [];

// Reúne referencias de la interfaz para reutilizarlas en los eventos.
const elements = {
  accountToggle: document.querySelector("#account-toggle"),
  registerToggle: document.querySelector("#register-toggle"),
  reservationsToggle: document.querySelector("#reservations-toggle"),
  logoutButton: document.querySelector("#logout-button"),
  loginDialog: document.querySelector("#login-dialog"),
  registerDialog: document.querySelector("#register-dialog"),
  loginClose: document.querySelector("#login-close"),
  registerClose: document.querySelector("#register-close"),
  loginForm: document.querySelector("#login-form"),
  registerForm: document.querySelector("#register-form"),
  accountType: document.querySelector("#account-type"),
  corporateFields: document.querySelector("#corporate-fields"),
  searchForm: document.querySelector("#search-form"),
  searchMessage: document.querySelector("#search-message"),
  flightResults: document.querySelector("#flight-results"),
  profileSection: document.querySelector("#profile-section"),
  reservationList: document.querySelector("#reservation-list"),
  milesBalance: document.querySelector("#miles-balance"),
  agentSection: document.querySelector("#agent-section"),
  newFlightForm: document.querySelector("#new-flight-form"),
  agentFlightList: document.querySelector("#agent-flight-list")
};

// Ejecuta la carga inicial y conecta las acciones de la página.
document.addEventListener("DOMContentLoaded", initialize);

// Carga los vuelos, restaura la sesión del navegador y conecta los formularios.
async function initialize() {
  bindEvents();

  try {
    await loadFlights();
    const savedUserId = sessionStorage.getItem("bitjetUserId");

    if (savedUserId) {
      currentUser = await api(`/users/${encodeURIComponent(savedUserId)}`);
      await updateAccountView();
    } else {
      renderFlights(flightsCache);
    }
  } catch (error) {
    showMessage(elements.searchMessage, `No se pudieron cargar los datos locales: ${error.message}`, "error");
    elements.flightResults.innerHTML = "";
  }
}

// Asocia los envíos y botones con sus manejadores correspondientes.
function bindEvents() {
  elements.accountToggle.addEventListener("click", () => toggleAccount("login"));
  elements.registerToggle.addEventListener("click", () => toggleAccount("register"));
  elements.reservationsToggle.addEventListener("click", toggleReservationsPanel);
  elements.loginClose.addEventListener("click", () => elements.loginDialog.close());
  elements.registerClose.addEventListener("click", () => elements.registerDialog.close());
  elements.logoutButton.addEventListener("click", logout);
  elements.searchForm.addEventListener("submit", searchFlights);
  elements.loginForm.addEventListener("submit", login);
  elements.registerForm.addEventListener("submit", register);
  elements.accountType.addEventListener("change", syncCorporateFields);
  syncCorporateFields();
  elements.flightResults.addEventListener("click", handleFlightAction);
  elements.reservationList.addEventListener("click", handleReservationAction);
  elements.newFlightForm.addEventListener("submit", addFlight);
  elements.agentFlightList.addEventListener("submit", updateFlight);
}

// Muestra los datos de compañía solo para cuentas corporativas y los exige en ese caso.
function syncCorporateFields() {
  const isCorporate = elements.accountType.value === "corporate";
  elements.corporateFields.hidden = !isCorporate;

  elements.corporateFields.querySelectorAll("input").forEach((input) => {
    input.required = isCorporate;

    if (!isCorporate) {
      input.value = "";
    }
  });
}

// Realiza solicitudes JSON y comunica los errores HTTP en lugar de ocultarlos.
async function api(path, options = {}) {
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
async function loadFlights() {
  flightsCache = await api("/flights?_sort=date,departure");
  renderFlights(flightsCache);
}

// Muestra un mensaje accesible con el tipo visual solicitado.
function showMessage(target, text, kind = "") {
  target.textContent = text;

  if (kind) {
    target.dataset.kind = kind;
  } else {
    delete target.dataset.kind;
  }
}

// Escapa valores del JSON antes de insertarlos en plantillas HTML.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Formatea precios en pesos dominicanos para esta demostración local.
function formatCurrency(amount) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);
}

// Formatea una fecha local sin desplazarla al día anterior por la zona horaria.
function formatDate(date) {
  if (!date) {
    return "Fecha no disponible";
  }

  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium"
  }).format(new Date(`${date}T12:00:00`));
}

// Convierte una hora de 24 horas a una etiqueta legible.
function formatTime(time) {
  return time || "Hora no disponible";
}

// Abre el diálogo solicitado y enfoca su primer campo.
function toggleAccount(formName) {
  const isRegister = formName === "register";
  const dialog = isRegister ? elements.registerDialog : elements.loginDialog;
  const targetForm = isRegister ? elements.registerForm : elements.loginForm;
  if (isRegister) {
    syncCorporateFields();
  }

  dialog.showModal();
  targetForm.querySelector("input").focus();
}

// Alterna la vista de reservas para clientes autenticados.
function toggleReservationsPanel() {
  if (!currentUser || currentUser.role === "agent") {
    return;
  }

  const isHidden = elements.profileSection.hidden;
  elements.profileSection.hidden = !isHidden;
  elements.reservationsToggle.setAttribute("aria-expanded", String(!elements.profileSection.hidden));
  elements.reservationsToggle.classList.toggle("is-active", !elements.profileSection.hidden);

  if (!elements.profileSection.hidden) {
    elements.profileSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Filtra los vuelos locales por ruta, fecha y hora de salida seleccionadas.
async function searchFlights(event) {
  event.preventDefault();
  const formData = new FormData(elements.searchForm);
  const origin = String(formData.get("origin")).trim().toLowerCase();
  const destination = String(formData.get("destination")).trim().toLowerCase();
  const date = String(formData.get("date"));
  const departureAfter = String(formData.get("departureAfter"));

  try {
    await loadFlights();
    const matches = flightsCache.filter((flight) => {
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

    renderFlights(matches);
    showMessage(
      elements.searchMessage,
      matches.length ? `${matches.length} vuelo(s) encontrado(s).` : "No hay vuelos para esos criterios; prueba otra fecha u hora.",
      matches.length ? "success" : ""
    );
  } catch (error) {
    showMessage(elements.searchMessage, `No se pudo completar la búsqueda: ${error.message}`, "error");
  }
}

// Dibuja las tarjetas de vuelo y habilita la reserva únicamente a clientes.
function renderFlights(flights) {
  if (!flights.length) {
    elements.flightResults.innerHTML = '<p class="booking-hint">No hay vuelos para mostrar.</p>';
    return;
  }

  elements.flightResults.innerHTML = flights.map((flight) => {
    const freeSeats = flight.seats.filter((seat) => !flight.occupiedSeats.includes(seat));
    const seatOptions = freeSeats.map((seat) =>
      `<option value="${escapeHtml(seat)}">${escapeHtml(seat)}</option>`
    ).join("");
    const canBook = currentUser && currentUser.role !== "agent";
    const mileageInput = currentUser?.role === "corporate"
      ? `<label>Millas a canjear (1 milla = 1 DOP)
           <input name="miles" type="number" min="0" max="${Math.min(currentUser.miles, flight.price)}" step="1" value="0">
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
        <button class="button button-primary reserve-action-button" type="button" data-action="reserve" data-flight-id="${escapeHtml(flight.id)}">Reservar vuelo</button>
      `;
    } else if (currentUser?.role === "agent") {
      bookingContent = '<p class="booking-hint"><button class="inline-link" type="button" data-action="open-login">Inicia sesión</button> como cliente para reservar.</p>';
    } else {
      bookingContent = '<p class="booking-hint"><button class="inline-link" type="button" data-action="open-login">Inicia sesión</button> como cliente registrado para seleccionar un asiento y reservar.</p>';
    }

    return `
      <article class="flight-card">
        <div class="flight-main">
          <span class="flight-number">${escapeHtml(flight.id)}</span>
          <div class="route">
            <div class="route-point">
              <strong>${escapeHtml(flight.origin)}</strong>
              <span>${escapeHtml(flight.originName)}</span>
            </div>
            <span class="route-arrow" aria-hidden="true">→</span>
            <div class="route-point">
              <strong>${escapeHtml(flight.destination)}</strong>
              <span>${escapeHtml(flight.destinationName)}</span>
            </div>
          </div>
          <div class="flight-meta">
            <span>${escapeHtml(formatDate(flight.date))}</span>
            <span>Salida ${escapeHtml(formatTime(flight.departure))}</span>
            <span>Llegada ${escapeHtml(formatTime(flight.arrival))}</span>
            <span>${freeSeats.length} asiento(s) disponible(s)</span>
          </div>
          <span class="flight-status" data-status="${escapeHtml(flight.status)}">${escapeHtml(flight.status)}</span>
        </div>
        <div class="booking-box">
          <span class="fare">${escapeHtml(formatCurrency(flight.price))}</span>
          ${bookingContent}
        </div>
      </article>
    `;
  }).join("");
}

// Inicia sesión contra las cuentas locales y restaura el panel adecuado al rol.
async function login(event) {
  event.preventDefault();
  const message = document.querySelector("#login-message");
  const formData = new FormData(elements.loginForm);
  const email = String(formData.get("email")).trim().toLowerCase();
  const password = String(formData.get("password"));

  try {
    const users = await api(`/users?email=${encodeURIComponent(email)}`);
    const user = users.find((candidate) => candidate.password === password);

    if (!user) {
      showMessage(message, "Correo o contraseña incorrectos.", "error");
      return;
    }

    currentUser = user;
    sessionStorage.setItem("bitjetUserId", String(user.id));
    await updateAccountView();
    elements.loginDialog.close();
    showMessage(elements.searchMessage, `Sesión iniciada. Bienvenido/a, ${user.name}.`, "success");
  } catch (error) {
    showMessage(message, `No se pudo iniciar sesión: ${error.message}`, "error");
  }
}

// Registra una cuenta minorista o corporativa con los datos del formulario.
async function register(event) {
  event.preventDefault();
  const message = document.querySelector("#register-message");
  const formData = new FormData(elements.registerForm);
  const accountType = String(formData.get("accountType"));
  const company = String(formData.get("company")).trim();
  const rnc = String(formData.get("rnc")).trim();
  const email = String(formData.get("email")).trim().toLowerCase();

  if (accountType === "corporate" && (!company || !rnc)) {
    showMessage(message, "Para una cuenta corporativa, completa tanto la compañía como el RNC.", "error");
    return;
  }

  try {
    const existingUsers = await api(`/users?email=${encodeURIComponent(email)}`);

    if (existingUsers.length) {
      showMessage(message, "Ese correo ya está registrado.", "error");
      return;
    }

    // Las contraseñas en texto claro y la autenticación JSON solo son aptas para demostración local.
    // Sugerencia para producción: usar un servidor con contraseñas cifradas y sesiones seguras.
    const user = await api("/users", {
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

    currentUser = user;
    sessionStorage.setItem("bitjetUserId", String(user.id));
    elements.registerForm.reset();
    syncCorporateFields();
    await updateAccountView();
    elements.registerDialog.close();
    showMessage(elements.searchMessage, "Cuenta creada. El correo de confirmación se simula en esta versión local.", "success");
  } catch (error) {
    showMessage(message, `No se pudo crear la cuenta: ${error.message}`, "error");
  }
}

// Actualiza el encabezado, los vuelos y el módulo autorizado para el rol actual.
async function updateAccountView() {
  elements.accountToggle.hidden = Boolean(currentUser);
  elements.registerToggle.hidden = Boolean(currentUser);
  elements.logoutButton.hidden = !currentUser;
  elements.reservationsToggle.hidden = !currentUser || currentUser.role === "agent";

  if (currentUser) {
    elements.logoutButton.textContent = `Cerrar sesión (${currentUser.name})`;
  }

  const isClient = Boolean(currentUser) && currentUser.role !== "agent";
  elements.profileSection.hidden = !isClient;
  elements.reservationsToggle.setAttribute("aria-expanded", String(!elements.profileSection.hidden));
  elements.reservationsToggle.classList.toggle("is-active", !elements.profileSection.hidden);
  elements.agentSection.hidden = !currentUser || currentUser.role !== "agent";
  await loadFlights();

  if (currentUser?.role === "agent") {
    await renderAgentFlights();
    return;
  }

  if (currentUser) {
    elements.milesBalance.textContent = currentUser.role === "corporate"
      ? `Saldo: ${currentUser.miles} millas`
      : "Cuenta minorista";
    await renderReservations();
  }
}

// Cierra la sesión del navegador y conserva visibles los vuelos públicos.
function logout() {
  currentUser = null;
  sessionStorage.removeItem("bitjetUserId");
  elements.profileSection.hidden = true;
  elements.agentSection.hidden = true;
  elements.accountToggle.hidden = false;
  elements.registerToggle.hidden = false;
  elements.reservationsToggle.hidden = true;
  elements.reservationsToggle.setAttribute("aria-expanded", "false");
  elements.reservationsToggle.classList.remove("is-active");
  elements.logoutButton.hidden = true;
  renderFlights(flightsCache);
}

// Maneja la reserva de un asiento y la acumulación o redención de millas.
async function handleFlightAction(event) {
  const loginLink = event.target.closest("[data-action='open-login']");
  if (loginLink) {
    toggleAccount("login");
    return;
  }

  const button = event.target.closest("[data-action='reserve']");

  if (!button) {
    return;
  }

  if (!currentUser || currentUser.role === "agent") {
    showMessage(elements.searchMessage, "Inicia sesión con una cuenta de cliente para reservar.", "error");
    return;
  }

  const card = button.closest(".flight-card");
  const flightId = button.dataset.flightId;
  const seat = card.querySelector("[name='seat']").value;
  const milesInput = card.querySelector("[name='miles']");
  const milesToUse = milesInput ? Number(milesInput.value) : 0;

  if (!Number.isInteger(milesToUse) || milesToUse < 0 || milesToUse > currentUser.miles) {
    showMessage(elements.searchMessage, "La cantidad de millas debe ser un número entero dentro de tu saldo.", "error");
    return;
  }

  const originalButtonHtml = button.innerHTML;
  button.disabled = true;
  button.classList.add("is-loading");
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Reservando...</span>';

  try {
    const flight = await api(`/flights/${encodeURIComponent(flightId)}`);
    const currentPrice = Number(flight.price);

    if (!flight.seats.includes(seat) || flight.occupiedSeats.includes(seat)) {
      await loadFlights();
      showMessage(elements.searchMessage, "Ese asiento ya no está disponible. Actualizamos los asientos; elige otro.", "error");
      return;
    }

    if (milesToUse > currentPrice) {
      showMessage(elements.searchMessage, "No puedes canjear más millas que el precio del vuelo.", "error");
      return;
    }

    const finalPrice = currentPrice - milesToUse;
    const milesEarned = currentUser.role === "corporate" ? Math.floor(finalPrice) : 0;
    const updatedMiles = Number(currentUser.miles || 0) - milesToUse + milesEarned;
    const occupiedSeats = [...flight.occupiedSeats, seat];

    await api(`/flights/${encodeURIComponent(flight.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ occupiedSeats })
    });

    let reservation;

    try {
      reservation = await api("/reservations", {
        method: "POST",
        body: JSON.stringify({
          userId: currentUser.id,
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
        await api(`/flights/${encodeURIComponent(flight.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ occupiedSeats: flight.occupiedSeats })
        });
      } catch (rollbackError) {
        showMessage(elements.searchMessage, `No se guardó la reserva y no se pudo liberar el asiento: ${rollbackError.message}`, "error");
        return;
      }

      throw error;
    }

    if (currentUser.role === "corporate") {
      try {
        currentUser = await api(`/users/${encodeURIComponent(currentUser.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ miles: updatedMiles })
        });
      } catch (error) {
        showMessage(elements.searchMessage, `La reserva ${reservation.id} quedó guardada, pero no se pudo actualizar el saldo de millas: ${error.message}`, "error");
        await loadFlights();
        await renderReservations();
        return;
      }
    }

    // Sugerencia: conectar aquí el gestor de mails requerido para enviar confirmaciones reales.
    showMessage(elements.searchMessage, `✈ Reserva ${reservation.id} confirmada. La notificación por correo se simula localmente.`, "success");
    await updateAccountView();
  } catch (error) {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.innerHTML = originalButtonHtml;
    showMessage(elements.searchMessage, `No se pudo completar la reserva: ${error.message}`, "error");
  }
}

// Carga las reservas del usuario y muestra su estado y las condiciones de cancelación.
async function renderReservations() {
  if (!currentUser || currentUser.role === "agent") {
    return;
  }

  const reservations = await api(`/reservations?userId=${encodeURIComponent(currentUser.id)}&_sort=createdAt&_order=desc`);

  if (!reservations.length) {
    elements.reservationList.innerHTML = '<p class="booking-hint">Todavía no tienes reservas.</p>';
    return;
  }

  elements.reservationList.innerHTML = reservations.map((reservation) => {
    const refundable = isRefundEligible(reservation.flightDate, reservation.departure);
    const canCancel = reservation.status === "Confirmada";
    const refundText = canCancel
      ? refundable ? "Cancelación con devolución del 80% (con al menos 7 días de anticipación)." : "Cancelación sin devolución (menos de 7 días)."
      : `Devolución registrada: ${formatCurrency(reservation.refundAmount || 0)}.`;

    return `
      <article class="reservation-card">
        <div>
          <span class="flight-number">Reserva ${escapeHtml(reservation.id)} · ${escapeHtml(reservation.flightNumber)}</span>
          <h3>${escapeHtml(reservation.origin)} → ${escapeHtml(reservation.destination)}</h3>
          <p class="reservation-detail">${escapeHtml(formatDate(reservation.flightDate))} · Salida ${escapeHtml(reservation.departure)} · Asiento ${escapeHtml(reservation.seat)}</p>
          <p class="reservation-detail">Estado: ${escapeHtml(reservation.status)} · Total: ${escapeHtml(formatCurrency(reservation.price))}</p>
          <p class="reservation-detail">${escapeHtml(refundText)}</p>
        </div>
        ${canCancel ? `<button class="button button-quiet" type="button" data-action="cancel" data-reservation-id="${escapeHtml(reservation.id)}">Cancelar reserva</button>` : ""}
      </article>
    `;
  }).join("");
}

// Determina si faltan al menos siete días completos para la salida del vuelo.
function isRefundEligible(flightDate, departure) {
  // El documento dice una vez "después de una semana", pero los casos detallados exigen
  // al menos siete días antes del vuelo. Se aplica el criterio detallado; sugerencia:
  // confirmar con el equipo cuál de las dos formulaciones debe prevalecer.
  const departureAt = new Date(`${flightDate}T${departure}:00`);
  const daysUntilDeparture = (departureAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return daysUntilDeparture >= 7;
}

// Cancela una reserva, libera su asiento y registra el reembolso aplicable.
async function handleReservationAction(event) {
  const button = event.target.closest("[data-action='cancel']");

  if (!button || !currentUser) {
    return;
  }

  const reservationId = button.dataset.reservationId;

  try {
    const reservation = await api(`/reservations/${encodeURIComponent(reservationId)}`);

    if (Number(reservation.userId) !== Number(currentUser.id) || reservation.status !== "Confirmada") {
      showMessage(elements.searchMessage, "La reserva ya no está disponible para cancelación.", "error");
      return;
    }

    const flight = await api(`/flights/${encodeURIComponent(reservation.flightId)}`);
    // El monto se registra en JSON; no se transfiere dinero en esta demostración local.
    // Sugerencia: conectar un procesador de pagos antes de habilitar devoluciones reales.
    const refundAmount = isRefundEligible(reservation.flightDate, reservation.departure)
      ? Math.round(Number(reservation.price) * 0.8)
      : 0;
    const occupiedSeats = flight.occupiedSeats.filter((seat) => seat !== reservation.seat);

    await api(`/flights/${encodeURIComponent(flight.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ occupiedSeats })
    });

    try {
      await api(`/reservations/${encodeURIComponent(reservation.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Cancelada",
          refundAmount,
          cancelledAt: new Date().toISOString()
        })
      });
    } catch (error) {
      try {
        await api(`/flights/${encodeURIComponent(flight.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ occupiedSeats: flight.occupiedSeats })
        });
      } catch (rollbackError) {
        showMessage(elements.searchMessage, `La cancelación no se guardó y no se pudo volver a ocupar el asiento: ${rollbackError.message}`, "error");
        return;
      }

      throw error;
    }

    showMessage(elements.searchMessage, `Reserva cancelada. Reembolso de demostración: ${formatCurrency(refundAmount)}. El correo se simula localmente.`, "success");
    await loadFlights();
    await renderReservations();
  } catch (error) {
    showMessage(elements.searchMessage, `No se pudo cancelar la reserva: ${error.message}`, "error");
  }
}

// Agrega un vuelo nuevo al JSON local cuando inicia sesión un agente.
async function addFlight(event) {
  event.preventDefault();

  if (currentUser?.role !== "agent") {
    showMessage(document.querySelector("#agent-message"), "Se requiere una cuenta de agente.", "error");
    return;
  }

  const message = document.querySelector("#agent-message");
  const formData = new FormData(elements.newFlightForm);
  const id = String(formData.get("flightNumber")).trim().toUpperCase();
  const seats = String(formData.get("seats")).split(",").map((seat) => seat.trim()).filter(Boolean);

  if (!seats.length || new Set(seats).size !== seats.length) {
    showMessage(message, "Indica al menos un asiento y evita repetir números.", "error");
    return;
  }

  try {
    const existingFlights = await api(`/flights?id=${encodeURIComponent(id)}`);

    if (existingFlights.length) {
      showMessage(message, "Ese número de vuelo ya existe.", "error");
      return;
    }

    await api("/flights", {
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

    elements.newFlightForm.reset();
    showMessage(message, `Vuelo ${id} agregado.`, "success");
    await loadFlights();
    await renderAgentFlights();
  } catch (error) {
    showMessage(message, `No se pudo agregar el vuelo: ${error.message}`, "error");
  }
}

// Presenta formularios de actualización para los vuelos existentes.
async function renderAgentFlights() {
  const agentFlights = await api("/flights?_sort=date,departure");

  elements.agentFlightList.innerHTML = agentFlights.map((flight) => `
    <article class="agent-flight-card">
      <h3>${escapeHtml(flight.id)} · ${escapeHtml(flight.originName)} → ${escapeHtml(flight.destinationName)}</h3>
      <p class="reservation-detail">${escapeHtml(formatDate(flight.date))} · ${escapeHtml(flight.departure)} · ${escapeHtml(formatCurrency(flight.price))} · ${flight.occupiedSeats.length}/${flight.seats.length} asientos ocupados</p>
      <form class="agent-flight-form" data-flight-id="${escapeHtml(flight.id)}">
        <label>Fecha<input name="date" type="date" value="${escapeHtml(flight.date)}" required></label>
        <label>Salida<input name="departure" type="time" value="${escapeHtml(flight.departure)}" required></label>
        <label>Llegada<input name="arrival" type="time" value="${escapeHtml(flight.arrival)}" required></label>
        <label>Precio (DOP)<input name="price" type="number" min="1" step="1" value="${escapeHtml(flight.price)}" required></label>
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
async function updateFlight(event) {
  event.preventDefault();

  if (currentUser?.role !== "agent") {
    return;
  }

  const form = event.target;
  const formData = new FormData(form);
  const message = form.querySelector(".form-message");
  const price = Number(formData.get("price"));

  if (!Number.isFinite(price) || price <= 0) {
    showMessage(message, "El precio debe ser mayor que cero.", "error");
    return;
  }

  try {
    await api(`/flights/${encodeURIComponent(form.dataset.flightId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        date: String(formData.get("date")),
        departure: String(formData.get("departure")),
        arrival: String(formData.get("arrival")),
        price,
        status: String(formData.get("status"))
      })
    });

    showMessage(message, "Vuelo actualizado.", "success");
    await loadFlights();
    await renderAgentFlights();
  } catch (error) {
    showMessage(message, `No se pudo actualizar el vuelo: ${error.message}`, "error");
  }
}
