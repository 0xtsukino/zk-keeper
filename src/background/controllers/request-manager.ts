import pushMessage from "@src/util/pushMessage";
import { randomUUID } from "crypto";
import { EventEmitter2 } from "eventemitter2";
import { FinalizedRequest, PendingRequest, PendingRequestType, RequestResolutionAction } from "../interfaces";
import BrowserUtils from "./browser-utils";
import {setPendingRequest} from "@src/ui/ducks/requests";

let nonce = 0;

export default class RequestManager extends EventEmitter2 {
    private pendingRequests: Array<PendingRequest>;

    constructor() {
        super();
        this.pendingRequests = new Array();
    }

    getRequests = (): PendingRequest[] => {
        return this.pendingRequests;
    }

    finalizeRequest = async (payload: FinalizedRequest): Promise<boolean> => {
        const { id, action } = payload;
        if(!id) throw new Error('id not provided');
        if(!action) throw new Error('action is not provided');
        //TODO add some mutex lock just in case something strange occurs
        this.pendingRequests = this.pendingRequests.filter((pendingRequest: PendingRequest) => {
            return pendingRequest.id !== id;
        });
        this.emit(`${id}:finalized`, action);
        await pushMessage(setPendingRequest(this.pendingRequests));
        return true;
    }

    addToQueue = async (type: PendingRequestType): Promise<string> => {
        const id: string = '' + nonce++;
        this.pendingRequests.push({ id, type });
        await pushMessage(setPendingRequest(this.pendingRequests));
        await BrowserUtils.openPopup();
        return id;
    }

    newRequest = async (data: string, type: PendingRequestType) => {
        const id: string = await this.addToQueue(type);
        return new Promise((resolve, reject) => {
            this.once(`${id}:finalized`, (action: RequestResolutionAction) => {
                switch (action) {
                    case 'accept':
                        resolve(data);
                        return;
                    case 'reject':
                        reject(data);
                        return;
                    default:
                        throw new Error(`action: ${action} not supproted`);
                }
            })
        })
    }
}