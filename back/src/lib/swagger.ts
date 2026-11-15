/**
 * Especificación OpenAPI 3.0 para agents-agency back.
 * Montada en /api/docs solo fuera de producción.
 */
export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agents Agency API',
    version: '1.0.0',
    description: 'API del backend de 3A Estudio (agents-agency). Gestión de agentes IA, clientes, contactos, presupuestos, estudios de mercado y más.',
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Desarrollo local' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token Supabase (Authorization: Bearer <token>)',
      },
      OperatorServiceToken: {
        type: 'apiKey',
        in: 'header',
        name: 'x-service-token',
        description: 'Token estático de servicio del Operator Agent (server-to-server). Se compara contra OPERATOR_SERVICE_TOKEN en tiempo constante. Las rutas /service/operator/* van FUERA de /api y NO usan el Bearer JWT de usuario.',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'No autenticado' },
        },
      },
      Agent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          sectorId: { type: 'string', nullable: true },
          systemPrompt: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Client: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          email: { type: 'string', nullable: true },
          telefono: { type: 'string', nullable: true },
          direccion: { type: 'string', nullable: true },
          codigo: { type: 'string', nullable: true, description: 'Código corto tipo cli-01' },
          activo: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Contact: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'lost'] },
          agentId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Budget: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          clientId: { type: 'string', nullable: true },
          status: { type: 'string' },
          total: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Invoice: {
        type: 'object',
        description: 'Nace automáticamente al aceptar un Budget (ensureInvoiceForBudget). No existe alta manual.',
        properties: {
          id: { type: 'string' },
          budgetId: { type: 'string' },
          status: { type: 'string', enum: ['pendiente', 'cobrada'] },
          paidAt: { type: 'string', format: 'date-time', nullable: true, description: 'Se fija al pasar a cobrada; se limpia al salir de cobrada' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      MarketStudy: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string' },
          result: { type: 'object', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Sector: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      },
      Skill: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string', nullable: true },
        },
      },
      ChatMessage: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          content: { type: 'string' },
        },
      },
      PaginatedResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: {} },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    // ─── Auth ────────────────────────────────────────────────────────────────
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login de usuario',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Login correcto — devuelve token Supabase' },
          401: { description: 'Credenciales incorrectas', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Perfil del usuario autenticado',
        responses: {
          200: { description: 'Usuario actual con rol' },
          401: { description: 'No autenticado' },
        },
      },
    },

    // ─── Agentes ─────────────────────────────────────────────────────────────
    '/api/agents': {
      get: {
        tags: ['Agentes'],
        summary: 'Listar agentes IA',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Lista de agentes', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedResponse' } } } },
        },
      },
      post: {
        tags: ['Agentes'],
        summary: 'Crear agente',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } },
        },
        responses: {
          201: { description: 'Agente creado' },
          422: { description: 'Datos inválidos' },
        },
      },
    },
    '/api/agents/{id}': {
      get: {
        tags: ['Agentes'],
        summary: 'Obtener agente por ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Agente', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
          404: { description: 'No encontrado' },
        },
      },
      patch: {
        tags: ['Agentes'],
        summary: 'Actualizar agente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } },
        responses: { 200: { description: 'Agente actualizado' }, 404: { description: 'No encontrado' } },
      },
      delete: {
        tags: ['Agentes'],
        summary: 'Eliminar agente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' }, 404: { description: 'No encontrado' } },
      },
    },

    // ─── Chat ─────────────────────────────────────────────────────────────────
    '/api/chat/{agentId}': {
      post: {
        tags: ['Chat IA'],
        summary: 'Chatear con un agente',
        parameters: [{ name: 'agentId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['messages'],
                properties: {
                  messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                  contactId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Respuesta del agente', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatMessage' } } } },
          404: { description: 'Agente no encontrado' },
        },
      },
    },

    // ─── Clientes ─────────────────────────────────────────────────────────────
    '/api/clients': {
      get: {
        tags: ['Clientes'],
        summary: 'Listar clientes (tenants)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista de clientes' } },
      },
      post: {
        tags: ['Clientes'],
        summary: 'Crear cliente',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
        responses: { 201: { description: 'Cliente creado' } },
      },
    },
    '/api/clients/{id}': {
      get: {
        tags: ['Clientes'],
        summary: 'Obtener cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Cliente' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Clientes'],
        summary: 'Actualizar cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
        responses: { 200: { description: 'Cliente actualizado' } },
      },
      delete: {
        tags: ['Clientes'],
        summary: 'Eliminar cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Contactos ────────────────────────────────────────────────────────────
    '/api/contacts': {
      get: {
        tags: ['Contactos'],
        summary: 'Listar contactos / leads',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Lista de contactos' } },
      },
      post: {
        tags: ['Contactos'],
        summary: 'Crear contacto',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } },
        responses: { 201: { description: 'Contacto creado' } },
      },
    },
    '/api/contacts/{id}': {
      get: {
        tags: ['Contactos'],
        summary: 'Obtener contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Contacto' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Contactos'],
        summary: 'Actualizar contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Contact' } } } },
        responses: { 200: { description: 'Contacto actualizado' } },
      },
      delete: {
        tags: ['Contactos'],
        summary: 'Eliminar contacto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Presupuestos ─────────────────────────────────────────────────────────
    '/api/budgets': {
      get: {
        tags: ['Presupuestos'],
        summary: 'Listar presupuestos',
        responses: { 200: { description: 'Lista de presupuestos' } },
      },
      post: {
        tags: ['Presupuestos'],
        summary: 'Crear presupuesto',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Budget' } } } },
        responses: { 201: { description: 'Presupuesto creado' } },
      },
    },
    '/api/budgets/{id}': {
      get: {
        tags: ['Presupuestos'],
        summary: 'Obtener presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Presupuesto' }, 404: { description: 'No encontrado' } },
      },
      patch: {
        tags: ['Presupuestos'],
        summary: 'Actualizar presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Budget' } } } },
        responses: { 200: { description: 'Presupuesto actualizado' } },
      },
      delete: {
        tags: ['Presupuestos'],
        summary: 'Eliminar presupuesto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Facturas ─────────────────────────────────────────────────────────────
    // Router montado en /api/invoices (routes/invoices.ts) — reconciliación: existía en
    // código sin reflejo alguno en esta spec. Solo lectura + transición de cobro; el alta
    // es automática al aceptar un Budget (ver routes/budgets.ts, ensureInvoiceForBudget).
    '/api/invoices': {
      get: {
        tags: ['Facturas'],
        summary: 'Listar facturas (con budget/tenant/líneas embebidos)',
        description: 'Devuelve { invoices, metrics } — metrics agrega sobre TODAS las facturas (computeInvoiceMetrics).',
        responses: {
          200: { description: 'Lista de facturas + métricas' },
        },
      },
    },
    '/api/invoices/{id}': {
      get: {
        tags: ['Facturas'],
        summary: 'Obtener factura por id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Factura', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          404: { description: 'No encontrada' },
        },
      },
    },
    '/api/invoices/{id}/status': {
      put: {
        tags: ['Facturas'],
        summary: 'Marcar cobro / revertir estado',
        description: 'Set cerrado pendiente|cobrada. Al pasar a cobrada fija paidAt = now(); cualquier otro valor lo limpia (null).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['pendiente', 'cobrada'] } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Factura actualizada', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          404: { description: 'No encontrada' },
          422: { description: 'status inválido' },
        },
      },
    },

    // ─── Estudios de mercado ──────────────────────────────────────────────────
    '/api/market-studies': {
      get: {
        tags: ['Estudios de mercado'],
        summary: 'Listar estudios de mercado',
        responses: { 200: { description: 'Lista de estudios' } },
      },
      post: {
        tags: ['Estudios de mercado'],
        summary: 'Crear / iniciar estudio de mercado',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  sector: { type: 'string', nullable: true },
                  clientId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Estudio creado' } },
      },
    },
    '/api/market-studies/{id}': {
      get: {
        tags: ['Estudios de mercado'],
        summary: 'Obtener estudio',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Estudio' }, 404: { description: 'No encontrado' } },
      },
      delete: {
        tags: ['Estudios de mercado'],
        summary: 'Eliminar estudio',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Eliminado' } },
      },
    },

    // ─── Sectores ─────────────────────────────────────────────────────────────
    '/api/sectors': {
      get: {
        tags: ['Sectores'],
        summary: 'Listar sectores',
        responses: { 200: { description: 'Lista de sectores' } },
      },
    },
    '/api/sectors/{id}': {
      get: {
        tags: ['Sectores'],
        summary: 'Obtener sector',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Sector' }, 404: { description: 'No encontrado' } },
      },
    },

    // ─── Skills ───────────────────────────────────────────────────────────────
    '/api/skills': {
      get: {
        tags: ['Skills'],
        summary: 'Listar skills de agentes',
        responses: { 200: { description: 'Lista de skills' } },
      },
    },

    // ─── Stats ────────────────────────────────────────────────────────────────
    '/api/stats': {
      get: {
        tags: ['Estadísticas'],
        summary: 'Resumen estadístico global',
        responses: { 200: { description: 'KPIs globales: agentes, contactos, mensajes, presupuestos' } },
      },
    },

    // ─── Booking ──────────────────────────────────────────────────────────────
    '/api/booking/slots': {
      get: {
        tags: ['Booking'],
        summary: 'Obtener slots disponibles',
        parameters: [
          { name: 'agentId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Slots libres' } },
      },
    },
    '/api/booking': {
      post: {
        tags: ['Booking'],
        summary: 'Crear reserva',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['agentId', 'start', 'end'],
                properties: {
                  agentId: { type: 'string' },
                  contactId: { type: 'string', nullable: true },
                  start: { type: 'string', format: 'date-time' },
                  end: { type: 'string', format: 'date-time' },
                  notes: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Reserva creada' }, 409: { description: 'Slot no disponible' } },
      },
    },

    // ─── Operator Agent — Clientes y Contactos (lectura) ─────────────────────
    // Router serviceOperatorRouter (routes/service-operator.ts) montado en
    // /service/operator, FUERA de /api → no pasa por el gate JWT de usuario.
    // Paginación (S2/S13) ADITIVA: sin `limit`/`offset` la respuesta es la de
    // siempre; con cualquiera de los dos se pagina en la base de datos.
    '/service/operator/clientes': {
      get: {
        tags: ['Operator'],
        summary: 'Listar clientes activos (array legacy o página con metadatos)',
        description:
          'Sin `limit` ni `offset` devuelve el ARRAY de siempre y los parámetros desconocidos se ignoran. ' +
          'Con cualquiera de los dos pagina en la base de datos (skip/take + count, orden estable createdAt desc, id asc) ' +
          'y devuelve { clientes, total, limit, offset, hasMore, nextOffset }. El `offset` pedido se devuelve tal cual (nunca se recorta) y una página vacía siempre da hasMore=false y nextOffset=null. No es una foto transaccional: el orden es estable, la foto no.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400). Omitido junto con offset → respuesta legacy' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0). Para la siguiente página usa el nextOffset devuelto' },
        ],
        responses: {
          200: { description: 'Array de clientes (legacy) o { clientes[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'limit fuera de 1..200 o offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar los clientes' },
        },
      },
    },
    '/service/operator/contactos': {
      get: {
        tags: ['Operator'],
        summary: 'Listar contactos (array legacy del panel o página con metadatos)',
        description:
          'Sin `limit` ni `offset` se delega en el listado compartido del panel: ARRAY de siempre, filtros `type`/`contactado` y parámetros desconocidos ignorados. ' +
          'Con cualquiera de los dos usa una lectura propia acotada (proyección fija, skip/take + count en la base de datos, orden estable createdAt desc, id asc) y devuelve { contactos, total, limit, offset, hasMore, nextOffset }.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['lead', 'prospecto'] }, description: 'Filtro por tipo (ambos modos)' },
          { name: 'contactado', in: 'query', schema: { type: 'string', enum: ['si', 'no', 'nc'] }, description: 'Filtro por estado de contacto (ambos modos)' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400). Omitido junto con offset → respuesta legacy' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0)' },
        ],
        responses: {
          200: { description: 'Array de contactos (legacy) o { contactos[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'type/contactado fuera del enum, limit fuera de 1..200 u offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar los contactos' },
        },
      },
    },

    // ─── Operator Agent — Agenda ──────────────────────────────────────────────
    // Router serviceOperatorRouter (routes/service-operator.ts) montado en
    // /service/operator, FUERA de /api → no pasa por el gate JWT de usuario.
    // Se autentica SOLO con el header x-service-token (OperatorServiceToken).
    // Agenda del owner = PlatformAppointment (espejo de Google Calendar); la
    // escritura sincroniza con Google best-effort si la integración está conectada.
    // Nota: las escrituras de /agenda NO exigen `confirmado` (a diferencia de
    // /clientes y /agentes); solo el DELETE exige `confirmar=true`.
    '/service/operator/agenda': {
      get: {
        tags: ['Operator'],
        summary: 'Listar citas de la agenda del owner en un rango',
        description:
          'Sin `limit` ni `offset` devuelve el objeto de siempre: { desde, hasta, total, citas[] } con total = filas del rango. ' +
          'Con cualquiera de los dos pagina en la base de datos dentro del mismo rango (skip/take + count, orden estable startAt asc, id asc) y añade { limit, offset, hasMore, nextOffset }.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'desde', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto hoy' },
          { name: 'hasta', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto = desde' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Citas por página (1..200; por encima → 400). Omitido junto con offset → respuesta legacy' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Citas a saltar (entero >= 0)' },
        ],
        responses: {
          200: { description: '{ desde, hasta, total, citas[] } (legacy) o { desde, hasta, total, limit, offset, hasMore, nextOffset, citas[] }' },
          400: { description: 'desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde), limit fuera de 1..200 u offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
        },
      },
      post: {
        tags: ['Operator'],
        summary: 'Crear una cita en la agenda del owner',
        description: 'Persiste SIEMPRE en BD; si el Calendar de plataforma está conectado, replica el evento en Google (best-effort, no bloquea la respuesta). No requiere `confirmado`.',
        security: [{ OperatorServiceToken: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fecha', 'hora', 'cliente'],
                properties: {
                  fecha: { type: 'string', format: 'date', description: 'YYYY-MM-DD (hora de pared)' },
                  hora: { type: 'string', description: 'HH:MM (hora de pared)' },
                  cliente: { type: 'string' },
                  servicio: { type: 'string', nullable: true },
                  notas: { type: 'string', nullable: true },
                  duracion: { type: 'integer', nullable: true, description: 'Minutos; por defecto 30' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '{ ok: true, cita } — cita creada' },
          400: { description: 'fecha/hora/cliente obligatorios o fecha/hora inválidas' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudo crear la cita' },
        },
      },
    },
    '/service/operator/agenda/huecos': {
      get: {
        tags: ['Operator'],
        summary: 'Huecos libres de 30 min por día (09:00–19:00) en un rango',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'desde', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto hoy' },
          { name: 'hasta', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD; por defecto = desde' },
        ],
        responses: {
          200: { description: '{ desde, hasta, dias: [{ dia, huecos_libres }] } (huecos_libres=0 → día completo)' },
          400: { description: 'desde/hasta deben ser fechas YYYY-MM-DD válidas (hasta >= desde)' },
          401: { description: 'x-service-token ausente o inválido' },
        },
      },
    },
    '/service/operator/agenda/{id}': {
      patch: {
        tags: ['Operator'],
        summary: 'Editar una cita de la agenda',
        description: 'Actualiza fecha/hora/cliente/servicio/notas/estado. Sincroniza el cambio en Google best-effort si la cita ya está vinculada (gcalEventId). No requiere `confirmado`.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  fecha: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
                  hora: { type: 'string', description: 'HH:MM' },
                  cliente: { type: 'string' },
                  servicio: { type: 'string' },
                  notas: { type: 'string' },
                  estado: { type: 'string', enum: ['Confirmada', 'Pendiente', 'Completada', 'Cancelada'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, cita } — cita actualizada' },
          400: { description: 'estado inválido o fecha/hora inválidas' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Cita no encontrada' },
          500: { description: 'No se pudo editar la cita' },
        },
      },
      delete: {
        tags: ['Operator'],
        summary: 'Borrar una cita (irreversible)',
        description: 'Operación DESTRUCTIVA: elimina también el evento real en Google Calendar (best-effort). Exige `confirmar` truthy en query o body; sin ello → 400 confirmation_required.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirmar', in: 'query', schema: { type: 'boolean' }, description: 'Debe ser true (o "true"); también admisible en el body' },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { confirmar: { type: 'boolean', description: 'Alternativa a la query; true para confirmar' } },
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, borrada: id } — cita borrada' },
          400: { description: 'confirmar_requerido — reenviar con confirmar=true' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Cita no encontrada' },
          500: { description: 'No se pudo borrar la cita' },
        },
      },
    },

    // ─── Operator Agent — Agentes (lectura) ───────────────────────────────────
    // Router serviceOperatorAgentesRouter (routes/service-operator-agentes.ts)
    // montado en /service/operator/agentes, FUERA de /api → no pasa por el gate
    // JWT de usuario. Se autentica SOLO con x-service-token (OperatorServiceToken).
    // Superficie de SÓLO LECTURA: la proyección es una allowlist fija del servidor
    // (sin prompt, widget, ecommerce, clave pública, cupos ni knobs de conducta) y
    // la validación de query es estricta (un parámetro desconocido → 400).
    '/service/operator/agentes': {
      get: {
        tags: ['Operator'],
        summary: 'Listar agentes (paginado, ordenable, proyección seleccionable)',
        description: 'Devuelve { agentes, total, limit, offset, hasMore }. Orden por defecto createdAt descendente, así que «cuál fue el último agente que creamos» se responde con limit=1. Los parámetros de query no listados aquí son rechazados.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, description: 'Filas por página; máximo duro 100 (por encima → 400)' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar' },
          { name: 'orderBy', in: 'query', schema: { type: 'string', enum: ['createdAt'], default: 'createdAt' }, description: 'Único campo ordenable hoy' },
          { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }, description: 'Sentido del orden' },
          { name: 'campos', in: 'query', schema: { type: 'string', example: 'name,createdAt' }, description: 'Lista separada por comas de: id, name, sector, status, runtime, model, channel, publishedAt, statusChangedAt, createdAt, updatedAt, tenantId. Por defecto: id, name, sector, status, runtime, model, createdAt, updatedAt' },
        ],
        responses: {
          200: { description: '{ agentes[], total, limit, offset, hasMore }' },
          400: { description: 'Query no válida: parámetro desconocido, limit fuera de 1..100, offset negativo, orderBy distinto de createdAt o campos fuera del enum' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar los agentes' },
        },
      },
    },
    '/service/operator/agentes/{id}': {
      get: {
        tags: ['Operator'],
        summary: 'Ver un agente por id',
        description: 'Proyección fija del servidor (mismos campos que la allowlist anterior, todos). No admite parámetros de query.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Ficha del agente (allowlist de campos, sin prompt ni configuración)' },
          400: { description: 'Id no válido o parámetros de query no admitidos' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Agente no encontrado' },
          500: { description: 'No se pudo cargar el agente' },
        },
      },
    },

    // ─── Operator Agent — Conocimiento (lectura) ───────────────────────────
    // Router serviceOperatorConocimientoRouter (routes/service-operator-conocimiento.ts)
    // montado en /service/operator/conocimiento, FUERA de /api → no pasa por el gate
    // JWT de usuario. Se autentica SOLO con x-service-token (OperatorServiceToken).
    // Sólo lectura: no expone embedding, contenido completo, subida, ingesta, scrape,
    // DELETE de fuentes ni ecommerceConfig/ingest-status.
    '/service/operator/conocimiento/fuentes': {
      get: {
        tags: ['Operator'],
        summary: 'Fuentes indexadas de un agente con su nº de chunks (paginado)',
        description:
          'Devuelve { fuentes, total, limit, offset, hasMore, nextOffset }. Pagina en la base de datos ' +
          'con SQL crudo parametrizado (COUNT(DISTINCT fuente) + GROUP BY fuente LIMIT/OFFSET), nunca ' +
          'selecciona contenido ni embedding. El offset pedido se devuelve tal cual y una página vacía ' +
          'da hasMore=false y nextOffset=null.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'agentId', in: 'query', required: true, schema: { type: 'string' }, description: 'Agente del que listar fuentes' },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400)' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0)' },
          { name: 'orderBy', in: 'query', schema: { type: 'string', enum: ['source'], default: 'source' }, description: 'Único campo ordenable (fuente)' },
        ],
        responses: {
          200: { description: '{ fuentes[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'Query no válida: parámetro desconocido, agentId vacío, limit fuera de 1..200 u offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar las fuentes' },
        },
      },
    },
    '/service/operator/conocimiento/buscar': {
      get: {
        tags: ['Operator'],
        summary: 'Búsqueda semántica acotada en el conocimiento de un agente',
        description:
          'Reusa searchKnowledge (lib/embeddings.ts) tal cual. Devuelve { total, resultados: ' +
          '[{ source, snippet, similarity }] } con snippet <= 200 y similarity = round((1-distance)*100). ' +
          'total es la longitud realmente devuelta (nunca se fabrica hasta k). Lleva un rate limiter local ' +
          'de 20 req/min por proceso porque apiLimiter no cubre /service/*.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'agentId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 2000 }, description: 'Consulta (1..2000 caracteres)' },
          { name: 'k', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 5 }, description: 'Resultados máximos (1..20)' },
        ],
        responses: {
          200: { description: '{ total, resultados: [{ source, snippet, similarity }] }' },
          400: { description: 'Query no válida: parámetro desconocido, agentId/query vacío, query > 2000 o k fuera de 1..20' },
          401: { description: 'x-service-token ausente o inválido' },
          429: { description: 'Demasiadas búsquedas (rate limiter local por proceso)' },
          500: { description: 'No se pudo buscar en el conocimiento' },
        },
      },
    },

    // ─── Operator Agent — Landings (lectura) ───────────────────────────────
    // Router serviceOperatorLandingsRouter (routes/service-operator-landings.ts)
    // montado en /service/operator/landings, FUERA de /api. Se autentica SOLO con
    // x-service-token. Sólo lectura: proyección allowlist fija, sin files,
    // mobileFiles, answers, chatMessages ni generationPrompt.
    '/service/operator/landings': {
      get: {
        tags: ['Operator'],
        summary: 'Listar landings (paginado, ordenable, proyección seleccionable)',
        description:
          'Devuelve { landings, total, limit, offset, hasMore, nextOffset }. Proyección compacta por ' +
          'defecto (id, name, business, status, updatedAt); `campos` se valida contra un enum fijo. ' +
          'El offset pedido se devuelve tal cual y una página vacía da hasMore=false y nextOffset=null.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400)' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0)' },
          { name: 'orderBy', in: 'query', schema: { type: 'string', enum: ['updatedAt', 'createdAt'], default: 'updatedAt' }, description: 'Campo de orden' },
          { name: 'dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }, description: 'Sentido del orden' },
          { name: 'campos', in: 'query', schema: { type: 'string', example: 'name,createdAt' }, description: 'Lista separada por comas de: id, name, business, status, dbProvider, mobileStack, createdAt, updatedAt. Por defecto: id, name, business, status, updatedAt' },
        ],
        responses: {
          200: { description: '{ landings[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'Query no válida: parámetro desconocido, limit fuera de 1..200, offset negativo, orderBy/dir/campos fuera del enum' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar las landings' },
        },
      },
    },
    '/service/operator/landings/{id}': {
      get: {
        tags: ['Operator'],
        summary: 'Ver una landing por id',
        description: 'Proyección fija del servidor (allowlist del listado + qrUrl). No admite parámetros de query.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Landing (allowlist de campos, sin files/answers/generationPrompt)' },
          400: { description: 'Id no válido o parámetros de query no admitidos' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'Landing no encontrada' },
          500: { description: 'No se pudo cargar la landing' },
        },
      },
    },

    // ─── Operator Agent — Canales (lectura) ─────────────────────────────────
    // Router serviceOperatorCanalesRouter (routes/service-operator-canales.ts)
    // montado en /service/operator/canales, FUERA de /api. Se autentica SOLO con
    // x-service-token. Sólo lectura: proyección fija, sin credentials/webhookSecret,
    // nunca descifra y nunca expone metadata crudo.
    '/service/operator/canales': {
      get: {
        tags: ['Operator'],
        summary: 'Listar conexiones de canal (cross-agent, paginado)',
        description:
          'Devuelve { canales, total, limit, offset, hasMore, nextOffset } con select fijo ' +
          '[id, agentId, provider, status, statusDetail, botName, botUsername, managedBy, createdAt, updatedAt]. ' +
          'statusDetail se trunca a 120 caracteres y managedBy se deriva de metadata sin exponerlo.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400)' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0)' },
        ],
        responses: {
          200: { description: '{ canales[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'Query no válida: parámetro desconocido, limit fuera de 1..200 u offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
          500: { description: 'No se pudieron cargar los canales' },
        },
      },
    },
    '/service/operator/canales/{agentId}': {
      get: {
        tags: ['Operator'],
        summary: 'Listar conexiones de canal de un agente',
        description: 'Mismas filas y proyección fija que el listado, filtradas por agente, con el mismo sobre de paginación. 404 cuando el agente no tiene conexiones.',
        security: [{ OperatorServiceToken: [] }],
        parameters: [
          { name: 'agentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, description: 'Filas por página (1..200; por encima → 400)' },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Filas a saltar (entero >= 0)' },
        ],
        responses: {
          200: { description: '{ canales[], total, limit, offset, hasMore, nextOffset }' },
          400: { description: 'Id no válido, parámetro desconocido, limit fuera de 1..200 u offset no entero/negativo' },
          401: { description: 'x-service-token ausente o inválido' },
          404: { description: 'El agente no tiene canales conectados' },
          500: { description: 'No se pudieron cargar los canales del agente' },
        },
      },
    },
  },
};
