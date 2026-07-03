/*
 * Copyright © Région Nord Pas de Calais-Picardie, 2016.
 *
 * This file is part of OPEN ENT NG. OPEN ENT NG is a versatile ENT Project based on the JVM and ENT Core Project.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation (version 3 of the License).
 *
 * For the sake of explanation, any module that communicate over native
 * Web protocols, such as HTTP, with OPEN ENT NG is outside the scope of this
 * license and could be license under its own terms. This is merely considered
 * normal use of OPEN ENT NG, and does not fall under the heading of "covered work".
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

package net.atos.entng.timelinegenerator.controllers;

import java.util.*;
import java.util.function.Function;

import com.mongodb.client.model.Filters;
import fr.wseduc.mongodb.MongoDb;
import fr.wseduc.mongodb.MongoQueryBuilder;
import fr.wseduc.webutils.I18n;
import io.vertx.core.json.JsonArray;
import net.atos.entng.timelinegenerator.TimelineGenerator;

import net.atos.entng.timelinegenerator.explorer.TimelineGeneratorExplorerPlugin;
import net.atos.entng.timelinegenerator.services.EventService;
import net.atos.entng.timelinegenerator.services.TimelineService;
import net.atos.entng.timelinegenerator.services.impl.DefaultTimelineService;
import org.entcore.broker.api.dto.resources.ResourcesDeletedDTO;
import org.entcore.broker.api.publisher.BrokerPublisherFactory;
import org.entcore.broker.api.utils.AddressParameter;
import org.entcore.broker.proxy.ResourceBrokerPublisher;
import org.entcore.common.events.EventHelper;
import org.entcore.common.events.EventStore;
import org.entcore.common.events.EventStoreFactory;
import org.entcore.common.explorer.IdAndVersion;
import org.entcore.common.mongodb.MongoDbControllerHelper;
import org.entcore.common.user.UserInfos;
import org.entcore.common.user.UserUtils;
import io.vertx.core.Handler;
import io.vertx.core.Vertx;
import io.vertx.core.http.HttpServerRequest;
import org.vertx.java.core.http.RouteMatcher;
import io.vertx.core.json.JsonObject;


import fr.wseduc.rs.ApiDoc;
import fr.wseduc.rs.Delete;
import fr.wseduc.rs.Get;
import fr.wseduc.rs.Post;
import fr.wseduc.rs.Put;
import fr.wseduc.security.ActionType;
import fr.wseduc.security.SecuredAction;
import fr.wseduc.webutils.request.RequestUtils;

import static org.entcore.common.http.response.DefaultResponseHandler.leftToResponse;


public class TimelineController extends MongoDbControllerHelper {
	static final String RESOURCE_NAME = "timelinegenerator";
	private TimelineService timelineService;
	// Used for module "statistics"
	private EventService eventService;
	private final EventHelper eventHelper;

	private final TimelineGeneratorExplorerPlugin explorerPlugin;
	private final ResourceBrokerPublisher resourcePublisher;

	enum Operation { CREATE, UPDATE, DELETE }

	public TimelineController(final Vertx vertx, final String collection, final TimelineGeneratorExplorerPlugin plugin) {
		super(collection);
		this.explorerPlugin = plugin;
		final EventStore eventStore = EventStoreFactory.getFactory().getEventStore(TimelineGenerator.class.getSimpleName());
		this.eventHelper = new EventHelper(eventStore);
		// Initialize resource publisher for deletion notifications
		this.resourcePublisher = BrokerPublisherFactory.create(
				ResourceBrokerPublisher.class,
				vertx,
				new AddressParameter("application", TimelineGenerator.APPLICATION)
		);
	}

	@Override
	public void init(Vertx vertx, JsonObject config, RouteMatcher rm,
			Map<String, fr.wseduc.webutils.security.SecuredAction> securedActions) {
		super.init(vertx, config, rm, securedActions);
		final Map<String, List<String>> groupedActions = new HashMap<>();
		this.shareService = this.explorerPlugin.createShareService(groupedActions);
	}

	@Override
	protected Function<JsonObject, Optional<String>> jsonToOwnerId() {
		return json -> this.explorerPlugin.getCreatorForModel(json).map(user -> user.getUserId());
	}

	@Get("")
	@SecuredAction("timelinegenerator.view")
	public void view(HttpServerRequest request) {
		// Create event "access to application TimelineGenerator" and store it, for module "statistics"
		eventHelper.onAccess(request);

		// IHM React de migration (CCTP 51C) accessible via `?ui=react` (timelinegenerator-react.html).
		// ⚠️ Ce module a DÉJÀ une IHM edifice « explorer » (React) comme vue par défaut → on NE bascule PAS
		// le défaut (resterait ambigu). `?ui=react` = ma nouvelle IHM ; défaut = explorer/existant.
		final String uiParam = request.params().get("ui");
		final String frontendUi = "react".equals(this.config.getString("frontend-ui", "angular")) ? "react" : "angular";
		final String ui = ("react".equals(uiParam) || "angular".equals(uiParam)) ? uiParam : frontendUi;
		if ("react".equals(ui)) {
			renderView(request, new JsonObject(), "timelinegenerator-react.html", null);
			return;
		}

		// Get the view parameter from the request
		final String view = request.params().get("view");
		// Get the use-explorer-ui configuration from the config
		final boolean useNewUi = this.config.getBoolean("use-explorer-ui", true);
		// If the view is home, use the old ui by default
		if ("home".equals(view)) {
			if (useNewUi) {
				// use new ui by default
				renderView(request, new JsonObject(), "timelinegenerator-explorer.html", null);
			} else {
				// use old ui by default
				renderView(request);
			}
		} else if ("resource".equals(view)) {
			// force new ui
			renderView(request, new JsonObject(), "timelinegenerator-explorer.html", null);
		} else {
			// use old ui by default for routing
			renderView(request);
		}
	}

	@Get("/print")
	@SecuredAction("timelinegenerator.print")
	public void printView(HttpServerRequest request) {
        renderView(request, new JsonObject(), "timelinegenerator-print.html", null);
	}

	@Get("/timelines")
	@SecuredAction("timelinegenerator.list")
	public void listTimelines(HttpServerRequest request) {
		list(request);
	}

	@Get("/timeline/:id")
	@SecuredAction(value = "timelinegenerator.read", type = ActionType.RESOURCE)
	public void getTimeline(HttpServerRequest request) {
		retrieve(request);
	}


	@Get("/timeline/:id/data")
	@SecuredAction(value = "timelinegenerator.read", type = ActionType.RESOURCE)
	public void getTimelineData(HttpServerRequest request) {
		retrieve(request);
	}

	@Post("/timelines")
	@SecuredAction("timelinegenerator.create")
	public void createTimeline(final HttpServerRequest request) {
		UserUtils.getAuthenticatedUserInfos(eb, request)
				.onSuccess(user ->
					RequestUtils.bodyToJson(request, pathPrefix + "timeline", data ->
							create(request, createRes -> {
								if (createRes.succeeded()) {
									final JsonObject createdTimeline = createRes.result();
									// Create EVENT
									eventHelper.onCreateResource(request, RESOURCE_NAME);
									// Notify Explorer
									final JsonObject newTimeline = data.copy();
									newTimeline
											.put("owner", (new JsonObject()).put("userId", user.getUserId()).put("displayName", user.getUsername()))
											.put("version", System.currentTimeMillis())
											.put("_id", createdTimeline.getString("_id"));
									final Optional<Number> folderId = Optional.ofNullable(data.getNumber("folder"));
									explorerPlugin.notifyUpsert(user, newTimeline, folderId);
									// Render: the render is done by the create method above.
								}
							})
				))
				.onFailure(e -> unauthorized(request));
	}

	@Put("/timeline/:id")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void updateTimeline(final HttpServerRequest request) {
		final String id = request.params().get("id");

		UserUtils.getAuthenticatedUserInfos(eb, request)
				.onSuccess(user ->
					RequestUtils.bodyToJson(request, pathPrefix + "timeline", data -> {
						data.put("modified", MongoDb.now());

						((DefaultTimelineService) timelineService).update(id, data, updateRes -> {
							if (updateRes.isRight()) {
								// Notify Explorer
								data.put("_id", id);
								data.put("version", System.currentTimeMillis());
								explorerPlugin.notifyUpsert(user, data);
								// Render ok
								renderJson(request, updateRes.right().getValue());
							} else {
								renderErrorWithMessage(request, Operation.UPDATE, id, updateRes.left().getValue());
							}
						});
					})
				)
				.onFailure(e -> unauthorized(request));
	}


	@Delete("/timeline/:id")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void deleteTimeline(HttpServerRequest request) {
		final String id = request.params().get("id");

		UserUtils.getAuthenticatedUserInfos(eb, request)
				.onSuccess(user ->
					((DefaultTimelineService) timelineService).delete(id, deleteRes -> {
						if (deleteRes.isRight()) {// Notify resource deletion via broker and don't wait for completion
							final ResourcesDeletedDTO notification = ResourcesDeletedDTO.forSingleResource(id, TimelineGenerator.TYPE);
							resourcePublisher.notifyResourcesDeleted(notification);
							// Notify EUR and and don't wait for explorer notifications to complete
							explorerPlugin.notifyDeleteById(user, new IdAndVersion(id, System.currentTimeMillis()));
							// Render ok
							renderJson(request, deleteRes.right().getValue());
						} else {
							renderErrorWithMessage(request, Operation.DELETE, id, deleteRes.left().getValue());
						}
					})
				)
				.onFailure(e -> unauthorized(request));
	}

	@Get("/timeline/:id/print")
	@SecuredAction(value = "timelinegenerator.read", type = ActionType.RESOURCE)
	public void print(HttpServerRequest request) {
		final String id = request.params().get("id");
		UserUtils.getUserInfos(eb, request, user -> {
			if (user != null) {
				timelineService.retrieve(id, user, eTimeline -> {
					if (eTimeline.isRight()) {
						eventService.list(id, user, eEvents -> {
							if (eEvents.isRight()) {
								final JsonObject timelineWithEvents =
										eTimeline.right().getValue().put("events", eEvents.right().getValue());
								if ("json".equals(request.params().get("format"))) {
									renderJson(request, timelineWithEvents);
								} else {
									renderView(request, timelineWithEvents, "print.html", null);
								}
							} else {
								leftToResponse(request, eEvents.left());
							}
						});
					} else {
						leftToResponse(request, eTimeline.left());
					}
				});
			} else {
				unauthorized(request, "invalid.user");
			}
		});
	}

	@Get("/publish")
	@SecuredAction("timelinegenerator.publish")
	public void publish(final HttpServerRequest request) {
		// This route is used to create publish Workflow right, nothing to do
		return;
	}

	@Get("/share/json/:id")
	@ApiDoc("Share timeline by id.")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void shareTimeline(final HttpServerRequest request) {
		shareJson(request, false);
	}

	@Put("/share/json/:id")
	@ApiDoc("Share timeline by id.")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void shareTimelineSubmit(final HttpServerRequest request) {
	    UserUtils.getUserInfos(eb, request, new Handler<UserInfos>() {
            @Override
            public void handle(final UserInfos user) {
                if (user != null) {
                    final String id = request.params().get("id");
                    if (id == null || id.trim().isEmpty()) {
                        badRequest(request);
                        return;
                    }

                    JsonObject params = new JsonObject();
                    params.put("profilUri", "/userbook/annuaire#" + user.getUserId() + "#" + user.getType());
                    params.put("username", user.getUsername());
                    params.put("timelineUri", "/timelinegenerator#/view/" + id);
                    params.put("resourceUri", params.getString("timelineUri"));

                    shareJsonSubmit(request, "timelinegenerator.share", false, params, "headline");
                }
            }
        });
	}

	@Put("/share/remove/:id")
	@ApiDoc("Remove timeline by id.")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void removeShareTimeline(final HttpServerRequest request) {
		removeShare(request, false);
	}

	@Put("/share/resource/:id")
	@ApiDoc("Share timeline by id.")
	@SecuredAction(value = "timelinegenerator.manager", type = ActionType.RESOURCE)
	public void shareResource(final HttpServerRequest request) {
		UserUtils.getUserInfos(eb, request, new Handler<UserInfos>() {
			@Override
			public void handle(final UserInfos user) {
				if (user != null) {
					final String id = request.params().get("id");
					if(id == null || id.trim().isEmpty()) {
						badRequest(request, "invalid.id");
						return;
					}

					JsonObject params = new JsonObject();
					params.put("profilUri", "/userbook/annuaire#" + user.getUserId() + "#" + user.getType());
					params.put("username", user.getUsername());
					params.put("timelineUri", "/timelinegenerator#/view/" + id);
					params.put("resourceUri", params.getString("timelineUri"));

                    JsonObject pushNotif = new JsonObject()
                            .put("title", "timeline.push-notif.title")
                            .put("body", I18n.getInstance()
                                    .translate("timelinegenerator.push-notif.body",
                                            getHost(request),
                                            I18n.acceptLanguage(request),
                                            user.getUsername()
                                    ));

                    params.put("pushNotif", pushNotif);

					shareResource(request, "timelinegenerator.share", false, params, "headline");
				}
			}
		});
	}

	private void cleanFolders(String id, UserInfos user, List<String> recipientIds){
		//owner style keep the reference to the ressource
		JsonArray jsonRecipients = new JsonArray(recipientIds).add(user.getUserId());
		JsonObject query = MongoQueryBuilder.build(Filters.and(Filters.eq("ressourceIds", id), Filters.nin("owner.userId", jsonRecipients)));
		JsonObject update = new JsonObject().put("$pull", new JsonObject().put("ressourceIds", new JsonObject().put("$nin",jsonRecipients)));
		mongo.update("timelinegeneratorFolders", query, update, message -> {
			JsonObject body = message.body();
			if (!"ok".equals(body.getString("status"))) {
				String err = body.getString("error", body.getString("message", "unknown cleanFolder Error"));
				log.error("[cleanFolders] failed to clean folder because of: "+err);
			}
		});
	}

	public void doShareSucceed(HttpServerRequest request, String id, UserInfos user,JsonObject sharePayload, JsonObject result, boolean sendNotify){
		super.doShareSucceed(request, id, user, sharePayload, result, sendNotify);
		if(sharePayload!=null){
			Set<String> userIds = sharePayload.getJsonObject("users", new JsonObject()).getMap().keySet();
			Set<String> groupIds = sharePayload.getJsonObject("groups", new JsonObject()).getMap().keySet();
			UserUtils.getUserIdsForGroupIds(groupIds,user.getUserId(),this.eb, founded->{
				if(founded.succeeded()){
					List<String> userToKeep = new ArrayList<>(userIds);
					userToKeep.addAll(founded.result());
					cleanFolders(id, user, userToKeep);
				}else{
					log.error("[doShareSucceed] failed to found recipient because:",founded.cause());
				}
			});
		}
	}

	public void setTimelineService(TimelineService timelineService) {
		this.timelineService = timelineService;
	}

	public void setEventService(EventService eventService) {
		this.eventService = eventService;
	}

	private void renderErrorWithMessage(final HttpServerRequest request, final Operation operation, final String timelineNameOrId, final String cause) {
		final String errorMessage = "[Timelinegenerator] Error " + operation.name() + " timeline " + timelineNameOrId + ". Error: " + cause;
		log.error(errorMessage);
		renderError(request, new JsonObject().put("error", errorMessage));
	}

}
