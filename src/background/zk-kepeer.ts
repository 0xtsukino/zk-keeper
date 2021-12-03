import RPCAction from "@src/util/constants";
import { PendingRequestType, NewIdentityRequest, WalletInfo } from "@src/types";
import Web3 from "web3";
import Handler from "./controllers/handler";
import LockService from "./services/lock";
import IdentityService from "./services/identity";
import MetamaskService from "./services/metamask";
import ZkValidator from "./services/whitelisted";
import RequestManager from "./controllers/request-manager";
import SemaphoreService from "./services/protocols/semaphore";
import { ISafeProof, ISemaphoreProofRequest } from "./services/protocols/interfaces";
import ApprovalService from "./services/approval";
import ZkIdentityWrapper from "./identity-decorater";
import identityFactory from "./identity-factory";

export default class ZkKepperController extends Handler {
    private identityService: IdentityService;
    private metamaskService: MetamaskService;
    private zkValidator: ZkValidator;
    private requestManager: RequestManager;
    private semaphoreService: SemaphoreService;
    private approvalService: ApprovalService;
    constructor() {
        super();
        this.identityService = new IdentityService();
        this.metamaskService = new MetamaskService();
        this.zkValidator = new ZkValidator();
        this.requestManager = new RequestManager();
        this.semaphoreService = new SemaphoreService();
        this.approvalService = new ApprovalService();
    }

    initialize = async (): Promise<ZkKepperController> => {
        // common
        this.add(RPCAction.UNLOCL, LockService.unlock, this.metamaskService.ensure, this.identityService.unlock, this.approvalService.unlock);
        this.add(RPCAction.LOCK, LockService.logout);

        // requests
        this.add(RPCAction.GET_PENDING_REQUESTS, LockService.ensure, this.requestManager.getRequests);
        this.add(RPCAction.FINALIZE_REQUEST, LockService.ensure, this.requestManager.finalizeRequest);

        // web3
        this.add(RPCAction.CONNECT_METAMASK, LockService.ensure, this.metamaskService.connectMetamask);
        this.add(RPCAction.GET_WALLET_INFO, this.metamaskService.getWalletInfo);

        // identites
        this.add(RPCAction.CREATE_IDENTITY, LockService.ensure, this.metamaskService.ensure, async (payload: NewIdentityRequest) => {
            try {
                const { strategy, options } = payload;
                if(!strategy) throw new Error("strategy not provided");

                const web3: Web3 = await this.metamaskService.getWeb3();
                const walletInfo: WalletInfo | null = await this.metamaskService.getWalletInfo();

                const numOfIdentites = this.identityService.getNumOfIdentites();

                const config: any = {
                    ...options,
                    web3,
                    walletInfo,
                    name: options?.name || `Account${numOfIdentites}`
                }

                const identity: ZkIdentityWrapper | undefined = await identityFactory(strategy, config);
                if(!identity) throw new Error("Identity not created, make sure to check strategy");
                await this.identityService.insert(identity);
                return true;
            } catch(error: any) {
                throw new Error(error.message);
            }
        });

        this.add(RPCAction.GET_COMMITMENTS, LockService.ensure, this.identityService.getIdentityCommitments);

        // protocols
        this.add(RPCAction.SEMAPHORE_PROOF, LockService.ensure, this.zkValidator.validateZkInputs, async (payload: ISemaphoreProofRequest) => {
            const identity: ZkIdentityWrapper | undefined = await this.identityService.getActiveidentity();
            if(!identity) throw new Error("active identity not found");

            const safeProof: ISafeProof = await this.semaphoreService.genProof(identity.getZkIdentity(), payload);
            return this.requestManager.newRequest(JSON.stringify(safeProof), PendingRequestType.PROOF);
        });

        // injecting
        this.add(RPCAction.TRY_INJECT, LockService.ensure, (payload: any) => {
            const { origin }: { origin: string } = payload;
            if(!origin) throw new Error("Origin not provided");

            const includes: boolean = this.approvalService.isApproved(origin);
            if(includes) return 'approved';
            return this.requestManager.newRequest('approved', PendingRequestType.INJECT);
        });
        this.add(RPCAction.APPROVE_HOST, LockService.ensure, this.approvalService.add);
        this.add(RPCAction.REMOVE_HOST, LockService.ensure, this.approvalService.remove);

        // dev
        this.add(RPCAction.CLEAR_APPROVED_HOSTS, this.approvalService.empty);
        this.add(RPCAction.DUMMY_REQUEST, async () => this.requestManager.newRequest('hello from dummy', PendingRequestType.DUMMY));

        return this;
    }

}